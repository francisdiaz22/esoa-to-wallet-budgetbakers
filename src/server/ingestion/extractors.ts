import { LIMITS, isCsvLike, SUPPORTED_MIME_TYPES } from './limits.js';
import type { ExtractedDocument, TextLine, SourceFormat } from './contracts.js';
import type { TemporaryWorkspace } from './workspace.js';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import eng from '@tesseract.js-data/eng';
import sharp from 'sharp';

type CodedError = Error & { code?: string };

function codedError(code: string, message = code): CodedError {
  const error = new Error(message) as CodedError;
  error.code = code;
  return error;
}

function createPdfParser(buffer: Buffer): PDFParse {
  return new PDFParse({
    data: buffer,
    maxImageSize: LIMITS.MAX_IMAGE_PIXELS,
    canvasMaxAreaInBytes: LIMITS.MAX_PDF_DECODED_BYTES,
    stopAtErrors: true,
    useWorkerFetch: false,
  });
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
  ): Promise<ExtractedDocument> {
    const buffer = input.files[0].buffer;
    // Check encrypted PDF signature before parsing: pdf may be encrypted if contains /Encrypt
    // header checked via includes, no need to store
    // const header = buffer.subarray(0, 1024).toString('utf8');
    // Simple heuristic: if buffer contains /Encrypt and not too far, treat as encrypted
    // Real detection would use pdf parser; we keep lightweight.
    if (buffer.includes(Buffer.from('/Encrypt'))) {
      // Let caller handle encrypted_pdf error; we throw coded error
      const err = new Error('encrypted_pdf') as Error & { code?: string };
      err.code = 'encrypted_pdf';
      throw err;
    }
    let text: string;
    let pages: { num: number; text: string }[] = [];
    let parser: PDFParse | undefined;
    try {
      parser = createPdfParser(buffer);
      await assertPdfPageLimit(parser);
      const data = await parser.getText({ pageJoiner: '' });
      pages = data.pages;
      text = pages.map((page) => page.text).join('\n');
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'encrypted_pdf' || err.code === 'pdf_page_limit')
        throw e;
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
  ): Promise<ExtractedDocument> {
    if (!this.ocrEngine.isAvailable()) {
      const err = new Error('ocr_unavailable') as Error & { code?: string };
      err.code = 'ocr_unavailable';
      throw err;
    }
    let parser: PDFParse | undefined;
    try {
      parser = createPdfParser(input.files[0].buffer);
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
      if ((error as CodedError).code) throw error;
      throw codedError('unreadable_document');
    } finally {
      await parser?.destroy().catch(() => undefined);
    }
  }
}
