import { LIMITS, isCsvLike, SUPPORTED_MIME_TYPES } from './limits.js';
import type { ExtractedDocument, TextLine, SourceFormat } from './contracts.js';
import type { TemporaryWorkspace } from './workspace.js';
import { PDFParse, PasswordException } from 'pdf-parse';
import { createWorker, PSM } from 'tesseract.js';
import eng from '@tesseract.js-data/eng';
import sharp from 'sharp';

type CodedError = Error & { code?: string };

function codedError(code: string, message = code): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function createPdfParser(
  buffer: Buffer,
  password?: string,
  hasPassword = false,
): PDFParse {
  return new PDFParse({
    data: buffer,
    ...(hasPassword ? { password } : {}),
    maxImageSize: LIMITS.MAX_IMAGE_PIXELS,
    canvasMaxAreaInBytes: LIMITS.MAX_PDF_DECODED_BYTES,
    stopAtErrors: true,
    useWorkerFetch: false,
  });
}

function isUnsupportedEncryptionError(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string };
  return (
    candidate?.name === 'UnknownErrorException' &&
    /unsupported encryption|encryption(?: algorithm| method)?[^\n]*unsupported/i.test(
      candidate.message ?? '',
    )
  );
}

function mapPdfOpenError(
  error: unknown,
  hasPassword: boolean,
): CodedError | null {
  if (
    error instanceof PasswordException ||
    (error as { name?: string })?.name === 'PasswordException'
  ) {
    return codedError(
      hasPassword ? 'pdf_password_invalid' : 'pdf_password_required',
    );
  }
  if (isUnsupportedEncryptionError(error)) {
    return codedError('pdf_encryption_unsupported');
  }
  return null;
}

async function assertPdfPageLimit(parser: PDFParse): Promise<number> {
  const info = await parser.getInfo();
  if (info.total < 1) throw codedError('unreadable_document');
  if (info.total > LIMITS.MAX_PAGE_COUNT) throw codedError('pdf_page_limit');
  return info.total;
}

export type ValidatedInput = {
  fieldName: 'statement' | 'statementPages';
  files: {
    buffer: Buffer;
    originalName: string;
    mimeHint: string;
    detectedMime: string | null;
    size: number;
  }[];
};

export interface DocumentExtractor {
  readonly id: string;
  supports(input: ValidatedInput): boolean;
  extract(
    input: ValidatedInput,
    workspace: TemporaryWorkspace,
  ): Promise<ExtractedDocument>;
}

// Helper to create TextLines from raw text
function textToLines(
  text: string,
  page: number,
  startOrder: number,
  sourceFormat: SourceFormat,
  confidence?: number,
): TextLine[] {
  const rawLines = text.split(/\r?\n/);
  const lines: TextLine[] = [];
  let order = startOrder;
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    // enforce max text length per line? just keep
    lines.push({ page, order: order++, text: trimmed, confidence });
  }
  return lines;
}

/**
 * Repairs conservative, layout-independent OCR segmentation artifacts while
 * leaving ordinary words untouched. This runs inside the OCR adapter; parser
 * description normalization remains whitespace-only.
 */
export function repairCommonOcrArtifacts(raw: string): string {
  const withoutDateJunk = raw.replace(
    /(\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\s+)[~_=]+\s*/g,
    '$1',
  );
  return withoutDateJunk
    .replace(/\bI[lI]+\b/g, (token) => token.replaceAll('l', 'I'))
    .replace(/\b[A-Z]{3,}\b/g, (token) => {
      if (!/[AEIOUY]/.test(token)) {
        return token.replace(/([B-DF-HJ-NP-TV-Z])\1+/g, '$1');
      }
      return token.replace(
        /([B-DF-HJ-NP-TV-Z])([B-DF-HJ-NP-TV-Z])\2(?=[AEIOUY])/g,
        '$1$2',
      );
    });
}

// --- CSV Extractor ---
export class CsvExtractor implements DocumentExtractor {
  readonly id = 'csv-extractor';
  supports(input: ValidatedInput): boolean {
    if (input.files.length !== 1) return false;
    const f = input.files[0];
    // RFC-style CSV (BOM tolerated) detection
    if (f.detectedMime === SUPPORTED_MIME_TYPES.PDF) return false;
    // If detected image mime, not csv
    if (f.detectedMime && f.detectedMime.startsWith('image/')) return false;
    // Use csv heuristic
    if (isCsvLike(f.buffer)) return true;
    // Also if mimeHint is csv and signature absent, still consider csv
    if (f.mimeHint === SUPPORTED_MIME_TYPES.CSV && isCsvLike(f.buffer))
      return true;
    return false;
  }
  async extract(
    input: ValidatedInput,
    _workspace: TemporaryWorkspace,
  ): Promise<ExtractedDocument> {
    const buffer = input.files[0].buffer;
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.length > LIMITS.MAX_TEXT_LENGTH) throw new Error('text_too_long');
    const lines = textToLines(text, 1, 1, 'csv');
    return {
      sourceFormat: 'csv',
      pages: 1,
      lines,
      textLength: text.length,
    };
  }
}

// --- PDF Text Extractor ---
export class PdfTextExtractor implements DocumentExtractor {
  readonly id = 'pdf-text-extractor';
  supports(input: ValidatedInput): boolean {
    if (input.files.length !== 1) return false;
    const f = input.files[0];
    return f.detectedMime === SUPPORTED_MIME_TYPES.PDF;
  }
  async extract(
    input: ValidatedInput,
    _workspace: TemporaryWorkspace,
    options?: { pdfPassword?: string; hasPdfPassword?: boolean },
  ): Promise<ExtractedDocument> {
    const buffer = input.files[0].buffer;
    const hasPassword = options?.hasPdfPassword === true;
    let text: string;
    let pages: { num: number; text: string }[] = [];
    let parser: PDFParse | undefined;
    try {
      parser = createPdfParser(buffer, options?.pdfPassword, hasPassword);
      await assertPdfPageLimit(parser);
      const data = await parser.getText({ pageJoiner: '' });
      pages = data.pages;
      text = pages.map((page) => page.text).join('\n');
    } catch (e) {
      const err = e as Error & { code?: string };
      const mapped = mapPdfOpenError(e, hasPassword);
      if (mapped) throw mapped;
      if (err.code === 'pdf_page_limit') throw e;
      // If pdf-parse fails or not available, treat as no usable text
      text = '';
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
    if (text.trim().length < LIMITS.MIN_USABLE_NATIVE_TEXT_LENGTH) {
      const err = new Error('no_usable_text') as Error & { code?: string };
      err.code = 'no_usable_text';
      throw err;
    }
    if (text.length > LIMITS.MAX_TEXT_LENGTH) throw new Error('text_too_long');
    let order = 1;
    const lines = pages.flatMap((page) => {
      const pageLines = textToLines(page.text, page.num, order, 'pdf-text');
      order += pageLines.length;
      return pageLines;
    });
    return {
      sourceFormat: 'pdf-text',
      pages: pages.length,
      lines,
      textLength: text.length,
    };
  }
}

// --- OCR Engine Interface ---
export interface OcrEngine {
  readonly id: string;
  isAvailable(): boolean;
  extract(images: { buffer: Buffer; page: number }[]): Promise<TextLine[]>;
}

// Explicit unavailable adapter for dependency-injected failure tests/fallbacks.
export class UnavailableOcrEngine implements OcrEngine {
  readonly id = 'ocr-unavailable';
  isAvailable(): boolean {
    return false;
  }
  async extract(): Promise<TextLine[]> {
    const err = new Error('ocr_unavailable') as Error & { code?: string };
    err.code = 'ocr_unavailable';
    throw err;
  }
}

// Fake deterministic OCR for tests / synthetic fixture
export class FakeOcrEngine implements OcrEngine {
  readonly id = 'fake-ocr';
  constructor(private lines: TextLine[]) {}
  isAvailable(): boolean {
    return true;
  }
  async extract(
    images: { buffer: Buffer; page: number }[],
  ): Promise<TextLine[]> {
    // Return preset lines, adjusting page if needed but preserving order
    // If images pages correspond to fixture pages, filter by page
    const pagesProvided = new Set(images.map((i) => i.page));
    // If preset lines match pagesProvided, return them; else return all
    if (pagesProvided.size > 0) {
      const filtered = this.lines.filter((l) => pagesProvided.has(l.page));
      if (filtered.length > 0) return filtered;
    }
    return this.lines;
  }
}

/** Offline OCR backed by pinned Tesseract.js and bundled English model data. */
export class LocalTesseractOcrEngine implements OcrEngine {
  readonly id = 'tesseract-js-eng-v6';

  isAvailable(): boolean {
    return true;
  }

  async extract(
    images: { buffer: Buffer; page: number }[],
  ): Promise<TextLine[]> {
    const worker = await createWorker('eng', 1, {
      langPath: eng.langPath,
      gzip: eng.gzip,
      cacheMethod: 'none',
    });
    const lines: TextLine[] = [];
    let order = 1;
    try {
      for (const image of images) {
        const metadata = await sharp(image.buffer, {
          limitInputPixels: LIMITS.MAX_IMAGE_PIXELS,
        }).metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width * metadata.height > LIMITS.MAX_IMAGE_PIXELS
        ) {
          const error = new Error('image_pixel_limit') as Error & {
            code?: string;
          };
          error.code = 'image_pixel_limit';
          throw error;
        }
        const targetWidth = Math.min(metadata.width * 2, 2400);
        const prepared = await sharp(image.buffer, {
          limitInputPixels: LIMITS.MAX_IMAGE_PIXELS,
        })
          .resize({ width: targetWidth, withoutEnlargement: false })
          .grayscale()
          .sharpen()
          .jpeg({ quality: 95 })
          .toBuffer();
        const recognized = await worker.recognize(prepared);
        const confidence = Math.max(
          0,
          Math.min(1, recognized.data.confidence / 100),
        );
        for (const raw of recognized.data.text.split(/\r?\n/)) {
          const text = repairCommonOcrArtifacts(raw.trim());
          if (text)
            lines.push({ page: image.page, order: order++, text, confidence });
        }

        // Tesseract's automatic segmentation can read a ruled continuation
        // page column-by-column. A sparse-text pass often restores the visual
        // row order needed by table parsers. The PNB header is distinctive
        // enough to scope this extra pass without changing other layouts.
        if (/account\s+details|trans\s+date|reference\s+number/i.test(recognized.data.text)) {
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          });
          const tableRecognized = await worker.recognize(prepared);
          for (const raw of tableRecognized.data.text.split(/\r?\n/)) {
            const text = repairCommonOcrArtifacts(raw.trim());
            if (text)
              lines.push({
                page: image.page,
                order: order++,
                text,
                confidence: Math.max(
                  0,
                  Math.min(1, tableRecognized.data.confidence / 100),
                ),
              });
          }

          // Ruled continuation pages can still be emitted column-by-column by
          // sparse mode. A single-block pass favors the visual row structure.
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
            preserve_interword_spaces: '1',
          });
          const blockRecognized = await worker.recognize(prepared);
          for (const raw of blockRecognized.data.text.split(/\r?\n/)) {
            const text = repairCommonOcrArtifacts(raw.trim());
            if (text)
              lines.push({
                page: image.page,
                order: order++,
                text,
                confidence: Math.max(
                  0,
                  Math.min(1, blockRecognized.data.confidence / 100),
                ),
              });
          }
        }

        // Table-style PNB eSOAs can put a label row (for example, STATEMENT
        // DATE) and its value row on separate visual lines. The default page
        // mode may read the labels but omit the small value row entirely. A
        // header-only pass with sparse-text segmentation recovers such dates.
        // Scope it to PNB-like pages so continuation-line ordering for other
        // parsers remains unchanged.
        if (
          /statement\s+of\s+account/i.test(recognized.data.text) &&
          /statement\s+date/i.test(recognized.data.text) &&
          !/\bbdo\b|sale\s+date|instalment|reference:/i.test(
            recognized.data.text,
          )
        ) {
          const headerHeight = Math.max(1, Math.floor(metadata.height * 0.32));
          const header = await sharp(image.buffer, {
            limitInputPixels: LIMITS.MAX_IMAGE_PIXELS,
          })
            .extract({
              left: 0,
              top: 0,
              width: metadata.width,
              height: headerHeight,
            })
            .resize({ width: targetWidth, withoutEnlargement: false })
            .grayscale()
            .sharpen()
            .jpeg({ quality: 95 })
            .toBuffer();
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          });
          const headerRecognized = await worker.recognize(header);
          for (const raw of headerRecognized.data.text.split(/\r?\n/)) {
            const text = repairCommonOcrArtifacts(raw.trim());
            if (text)
              lines.push({
                page: image.page,
                order: order++,
                text,
                confidence: Math.max(
                  0,
                  Math.min(1, headerRecognized.data.confidence / 100),
                ),
              });
          }
        }
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      }
      return lines;
    } finally {
      await worker.terminate();
    }
  }
}

// --- Image OCR Extractor ---
export class ImageOcrExtractor implements DocumentExtractor {
  readonly id = 'image-ocr-extractor';
  constructor(private ocrEngine: OcrEngine) {}
  supports(input: ValidatedInput): boolean {
    // Supports if any file is image signature OR PDF that failed text extraction (fallback routing handles order)
    // For routing, this is 4th step: image signature
    if (input.fieldName === 'statementPages') {
      // statementPages are expected to be images
      return input.files.every((f) => f.detectedMime?.startsWith('image/'));
    }
    if (input.files.length !== 1) return false;
    const f = input.files[0];
    return !!f.detectedMime?.startsWith('image/');
  }
  async extract(
    input: ValidatedInput,
    _workspace: TemporaryWorkspace,
  ): Promise<ExtractedDocument> {
    if (!this.ocrEngine.isAvailable()) {
      const err = new Error('ocr_unavailable') as Error & { code?: string };
      err.code = 'ocr_unavailable';
      throw err;
    }
    // Decompression/pixel guard: approximate by file size; real would check dimensions
    for (const f of input.files) {
      if (f.size > LIMITS.MAX_FILE_SIZE_BYTES) {
        const err = new Error('file_too_large') as Error & { code?: string };
        err.code = 'file_too_large';
        throw err;
      }
    }
    const images = input.files.map((f, idx) => ({
      buffer: f.buffer,
      page: input.fieldName === 'statementPages' ? idx + 1 : 1,
    }));
    const lines = await this.ocrEngine.extract(images);
    const totalText = lines.map((l) => l.text).join('\n');
    if (totalText.length > LIMITS.MAX_TEXT_LENGTH) {
      const err = new Error('text_too_long') as Error & { code?: string };
      err.code = 'text_too_long';
      throw err;
    }
    // Ensure lines have confidence
    const withConfidence = lines.map((l) => ({
      ...l,
      confidence: l.confidence ?? 0.98,
    }));
    return {
      sourceFormat: 'ocr',
      pages: input.files.length,
      lines: withConfidence,
      textLength: totalText.length,
    };
  }
}

// --- Scanned PDF OCR Extractor (PDF without usable text -> render then OCR) ---
export class ScannedPdfOcrExtractor implements DocumentExtractor {
  readonly id = 'scanned-pdf-ocr-extractor';
  constructor(private ocrEngine: OcrEngine) {}
  supports(input: ValidatedInput): boolean {
    // This is technically step 3 in routing: PDF without usable text
    // We return true for PDF; routing will try PdfTextExtractor first and fallback here on no_usable_text
    if (input.files.length !== 1) return false;
    return input.files[0].detectedMime === SUPPORTED_MIME_TYPES.PDF;
  }
  async extract(
    input: ValidatedInput,
    _workspace: TemporaryWorkspace,
    options?: { pdfPassword?: string; hasPdfPassword?: boolean },
  ): Promise<ExtractedDocument> {
    if (!this.ocrEngine.isAvailable()) {
      const err = new Error('ocr_unavailable') as Error & { code?: string };
      err.code = 'ocr_unavailable';
      throw err;
    }
    let parser: PDFParse | undefined;
    try {
      const hasPassword = options?.hasPdfPassword === true;
      parser = createPdfParser(
        input.files[0].buffer,
        options?.pdfPassword,
        hasPassword,
      );
      const pageCount = await assertPdfPageLimit(parser);
      const screenshots = await parser.getScreenshot({
        desiredWidth: LIMITS.PDF_RENDER_WIDTH,
        imageBuffer: true,
        imageDataUrl: false,
      });
      if (screenshots.pages.length !== pageCount) {
        throw codedError('unreadable_document');
      }

      let renderedPixels = 0;
      const images = screenshots.pages.map((page) => {
        const pagePixels = page.width * page.height;
        if (
          !Number.isFinite(pagePixels) ||
          pagePixels > LIMITS.MAX_IMAGE_PIXELS
        ) {
          throw codedError('pdf_decompression_limit');
        }
        renderedPixels += pagePixels;
        if (renderedPixels > LIMITS.MAX_PDF_RENDERED_PIXELS) {
          throw codedError('pdf_decompression_limit');
        }
        if (page.data.byteLength === 0) throw codedError('unreadable_document');
        return { buffer: Buffer.from(page.data), page: page.pageNumber };
      });

      const lines = await this.ocrEngine.extract(images);
      const totalText = lines.map((line) => line.text).join('\n');
      if (totalText.length > LIMITS.MAX_TEXT_LENGTH)
        throw codedError('text_too_long');
      return {
        sourceFormat: 'ocr',
        pages: pageCount,
        lines: lines.map((line) => ({
          ...line,
          confidence: line.confidence ?? 0.96,
        })),
        textLength: totalText.length,
      };
    } catch (error) {
      const mapped = mapPdfOpenError(error, options?.hasPdfPassword === true);
      if (mapped) throw mapped;
      if ((error as CodedError).code) throw error;
      throw codedError('unreadable_document');
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  }
}
