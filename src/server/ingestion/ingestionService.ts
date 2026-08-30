import {
  LIMITS,
  detectMimeBySignature,
  isCsvLike,
  SUPPORTED_MIME_TYPES,
} from './limits.js';
import { SessionStore } from './sessionStore.js';
import { TemporaryWorkspace } from './workspace.js';
import type {
  ExtractedDocument,
  ExtractionResult,
  ParserContext,
} from './contracts.js';
import {
  CsvExtractor,
  PdfTextExtractor,
  ImageOcrExtractor,
  ScannedPdfOcrExtractor,
  type ValidatedInput,
  type OcrEngine,
  LocalTesseractOcrEngine,
} from './extractors.js';
import { ParserRegistry } from './parserRegistry.js';
import { bdoParser } from './bdoParser.js';
import { validateParsedStatement, assembleResult } from './validation.js';

export type ServiceError = {
  status: number;
  code: string;
  message: string;
  stage?: string;
  requestId?: string;
};

export class IngestionService {
  private csvExtractor = new CsvExtractor();
  private pdfTextExtractor = new PdfTextExtractor();
  private ocrEngine: OcrEngine;
  private imageOcrExtractor: ImageOcrExtractor;
  private scannedPdfOcrExtractor: ScannedPdfOcrExtractor;
  private parserRegistry: ParserRegistry;

  constructor(
    private sessionStore: SessionStore,
    ocrEngine?: OcrEngine,
  ) {
    this.ocrEngine = ocrEngine ?? new LocalTesseractOcrEngine();
    this.imageOcrExtractor = new ImageOcrExtractor(this.ocrEngine);
    this.scannedPdfOcrExtractor = new ScannedPdfOcrExtractor(this.ocrEngine);
    this.parserRegistry = new ParserRegistry([bdoParser]);
  }

  /** Content-based validation + routing */
  validateInput(
    files: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }[],
    fieldName: 'statement' | 'statementPages' | null,
  ): { validated: ValidatedInput } | { error: ServiceError } {
    if (!fieldName || files.length === 0) {
      return {
        error: {
          status: 400,
          code: 'missing_input',
          message:
            'No file provided. Select a statement file or ordered image pages.',
          stage: 'validated',
        },
      };
    }
    // Mixed fields already prevented by caller, but double-check
    // Zero-byte check
    for (const f of files) {
      if (f.size === 0 || f.buffer.length === 0) {
        return {
          error: {
            status: 400,
            code: 'empty_file',
            message: 'File is empty.',
            stage: 'validated',
          },
        };
      }
      if (f.size > LIMITS.MAX_FILE_SIZE_BYTES) {
        return {
          error: {
            status: 413,
            code: 'file_too_large',
            message: `File exceeds ${LIMITS.MAX_FILE_SIZE_BYTES} bytes`,
            stage: 'validated',
          },
        };
      }
      if (
        f.originalname.includes('/') ||
        f.originalname.includes('\\') ||
        f.originalname.includes('..')
      ) {
        return {
          error: {
            status: 400,
            code: 'invalid_filename',
            message: 'Invalid filename.',
            stage: 'validated',
          },
        };
      }
    }
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total > LIMITS.MAX_TOTAL_UPLOAD_BYTES) {
      return {
        error: {
          status: 413,
          code: 'total_too_large',
          message: 'Total upload exceeds limit.',
          stage: 'validated',
        },
      };
    }
    if (fieldName === 'statement' && files.length !== 1) {
      return {
        error: {
          status: 400,
          code: 'too_many_files',
          message: 'Single statement expects one file.',
          stage: 'validated',
        },
      };
    }
    if (fieldName === 'statementPages') {
      if (
        files.length < LIMITS.MIN_PAGE_COUNT ||
        files.length > LIMITS.MAX_PAGE_COUNT
      ) {
        return {
          error: {
            status: 400,
            code: 'invalid_page_count',
            message: `statementPages expects ${LIMITS.MIN_PAGE_COUNT}-${LIMITS.MAX_PAGE_COUNT} images.`,
            stage: 'validated',
          },
        };
      }
    }

    const validatedFiles = files.map((f) => {
      const detected = detectMimeBySignature(f.buffer);
      // If not detected via magic, consider CSV heuristic
      let detectedMime: string | null = detected;
      if (!detectedMime && isCsvLike(f.buffer))
        detectedMime = SUPPORTED_MIME_TYPES.CSV;
      return {
        buffer: f.buffer,
        originalName: f.originalname,
        mimeHint: f.mimetype,
        detectedMime,
        size: f.size,
      };
    });

    // Check unsupported extension/signature combos outside supported set
    for (const vf of validatedFiles) {
      if (!vf.detectedMime) {
        // If file claims image/pdf/csv but signature unknown and not csv-like -> unsupported
        if (vf.mimeHint !== 'application/octet-stream' && vf.mimeHint !== '') {
          // Allow csv generic?
          // But if no signature and not csv, treat as unsupported
          // We already set csv heuristic, so remaining null means unsupported
          return {
            error: {
              status: 415,
              code: 'unsupported_file_type',
              message: 'Unsupported file type.',
              stage: 'validated',
            },
          };
        }
        return {
          error: {
            status: 415,
            code: 'unsupported_file_type',
            message: 'Unsupported file type.',
            stage: 'validated',
          },
        };
      }
      // Declared MIME vs magic mismatch
      // If mimeHint is provided and clearly different (e.g., text/csv but detected is image), reject
      // Normalize generic
      const hint = vf.mimeHint.toLowerCase();
      if (
        hint &&
        hint !== 'application/octet-stream' &&
        hint !== vf.detectedMime
      ) {
        // Allow text/csv vs text/plain variations
        const csvHints = new Set([
          'text/csv',
          'application/vnd.ms-excel',
          'text/plain',
        ]);
        const bothCsv =
          csvHints.has(hint) && vf.detectedMime === SUPPORTED_MIME_TYPES.CSV;
        if (!bothCsv) {
          return {
            error: {
              status: 415,
              code: 'mime_signature_mismatch',
              message: 'File type and content disagree.',
              stage: 'validated',
            },
          };
        }
      }
      // Extension/signature outside supported set already handled (detected null)
    }

    // Check encrypted PDF early
    for (const vf of validatedFiles) {
      if (vf.detectedMime === SUPPORTED_MIME_TYPES.PDF) {
        if (vf.buffer.includes(Buffer.from('/Encrypt'))) {
          return {
            error: {
              status: 422,
              code: 'encrypted_pdf',
              message: 'PDF is encrypted or password-protected.',
              stage: 'validated',
            },
          };
        }
      }
    }

    return { validated: { fieldName, files: validatedFiles } };
  }

  async process(
    validated: ValidatedInput,
    _requestId: string,
  ): Promise<{ result: ExtractionResult } | { error: ServiceError }> {
    const SAFE_MEMORY_LIMIT = 5 * 1024 * 1024;
    const totalSize = validated.files.reduce((s, f) => s + f.size, 0);
    if (!this.ocrEngine.isAvailable() && totalSize > SAFE_MEMORY_LIMIT) {
      return {
        error: {
          status: 413,
          code: 'document_too_large_for_memory_only_mode',
          message:
            'Document exceeds memory-only limit and encrypted workspace unavailable.',
          stage: 'validated',
        },
      };
    }

    const sessionId = SessionStore.generateId();
    const workspace = new TemporaryWorkspace(sessionId);
    const fail = (error: ServiceError): { error: ServiceError } => {
      workspace.clear();
      return { error };
    };

    let extractionDoc: ExtractedDocument;
    const stageExtract = 'extracting';
    try {
      if (this.csvExtractor.supports(validated)) {
        extractionDoc = await this.csvExtractor.extract(validated, workspace);
      } else if (
        validated.files.length === 1 &&
        validated.files[0].detectedMime === SUPPORTED_MIME_TYPES.PDF
      ) {
        try {
          extractionDoc = await this.pdfTextExtractor.extract(
            validated,
            workspace,
          );
        } catch (e) {
          const err = e as Error & { code?: string };
          if (err.code === 'encrypted_pdf')
            return fail({
              status: 422,
              code: 'encrypted_pdf',
              message: 'PDF is encrypted.',
              stage: stageExtract,
            });
          if (err.code === 'no_usable_text') {
            if (!this.ocrEngine.isAvailable()) {
              return fail({
                status: 422,
                code: 'ocr_unavailable',
                message: 'OCR engine unavailable for scanned PDF.',
                stage: stageExtract,
              });
            }
            extractionDoc = await this.scannedPdfOcrExtractor.extract(
              validated,
              workspace,
            );
          } else if (err.code === 'ocr_unavailable') {
            return fail({
              status: 422,
              code: 'ocr_unavailable',
              message: 'OCR unavailable.',
              stage: stageExtract,
            });
          } else {
            throw e;
          }
        }
      } else if (this.imageOcrExtractor.supports(validated)) {
        if (!this.ocrEngine.isAvailable()) {
          return fail({
            status: 422,
            code: 'ocr_unavailable',
            message: 'OCR engine unavailable for image.',
            stage: stageExtract,
          });
        }
        extractionDoc = await this.imageOcrExtractor.extract(
          validated,
          workspace,
        );
      } else {
        return fail({
          status: 415,
          code: 'unsupported_file_type',
          message: 'Unsupported file type.',
          stage: 'validated',
        });
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'encrypted_pdf')
        return fail({
          status: 422,
          code: 'encrypted_pdf',
          message: 'PDF is encrypted.',
          stage: stageExtract,
        });
      if (err.code === 'ocr_unavailable')
        return fail({
          status: 422,
          code: 'ocr_unavailable',
          message: 'OCR engine unavailable.',
          stage: stageExtract,
        });
      if (err.code === 'file_too_large' || err.code === 'image_pixel_limit')
        return fail({
          status: 413,
          code: err.code,
          message: 'Image exceeds the safe processing limit.',
          stage: stageExtract,
        });
      if (
        err.code === 'pdf_page_limit' ||
        err.code === 'pdf_decompression_limit'
      )
        return fail({
          status: 413,
          code: err.code,
          message: 'PDF exceeds the safe page or decoded-image limit.',
          stage: stageExtract,
        });
      return fail({
        status: 422,
        code: 'unreadable_document',
        message: 'Document could not be read.',
        stage: stageExtract,
      });
    }

    const registryResult = this.parserRegistry.findBestMatch(extractionDoc);
    if (!registryResult.parser) {
      return fail({
        status: 422,
        code: 'unsupported_layout',
        message: `Layout not recognized: ${registryResult.match.reason}`,
        stage: 'parsing',
      });
    }

    let parsed;
    try {
      const context = resolveBdoParserContext(extractionDoc);
      parsed = registryResult.parser.parse(extractionDoc, context);
    } catch {
      return fail({
        status: 422,
        code: 'missing_statement_context',
        message: 'Statement date could not be established safely.',
        stage: 'parsing',
      });
    }

    const validation = validateParsedStatement(parsed);
    if (!validation.valid) {
      return fail({
        status: 422,
        code: validation.error ?? 'invalid_extraction',
        message: `Validation failed: ${validation.error}`,
        stage: 'normalizing',
      });
    }

    const { result } = assembleResult(parsed, sessionId, validation.issues);
    const stored = this.sessionStore.createWithId(
      sessionId,
      {
        parserId: result.parserId,
        statementId: result.statementId,
        sourceFormat: result.sourceFormat,
        transactions: result.transactions,
        excludedRows: result.excludedRows,
        issues: result.issues,
        summary: result.summary,
      },
      workspace,
    );

    return { result: stored };
  }

  getExtraction(
    sessionId: string,
  ): { result: ExtractionResult } | { error: ServiceError } {
    const r = this.sessionStore.get(sessionId);
    if (!r)
      return {
        error: {
          status: 404,
          code: 'session_not_found',
          message: 'Session not found or cleared.',
          stage: 'complete',
        },
      };
    return { result: r };
  }

  clearSession(sessionId: string): void {
    this.sessionStore.clear(sessionId);
  }
}

export function createIngestionService(
  sessionStore: SessionStore,
  opts?: { ocrEngine?: OcrEngine },
): IngestionService {
  return new IngestionService(sessionStore, opts?.ocrEngine);
}

export function resolveBdoParserContext(
  document: ExtractedDocument,
): ParserContext {
  const joined = document.lines.map((line) => line.text).join('\n');
  const match = joined.match(
    /statement\s*date\s+([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i,
  );
  if (!match) throw new Error('missing_statement_context');
  const parsedDate = new Date(`${match[1]} ${match[2]}, ${match[3]} UTC`);
  if (Number.isNaN(parsedDate.getTime()))
    throw new Error('invalid_statement_context');
  const year = parsedDate.getUTCFullYear();
  const month = String(parsedDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getUTCDate()).padStart(2, '0');
  return {
    statementId: `BDO_VGOLD_${year}${month}${day}`,
    statementYear: year,
    currency: 'PHP',
  };
}
