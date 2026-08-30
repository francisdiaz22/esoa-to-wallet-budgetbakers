/**
 * Safe limits and supported types for ingestion.
 * Documented values for P1.1 — tested at boundaries.
 */
export const LIMITS = {
  /** Max size per uploaded file (bytes) — 10 MiB */
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,
  /** Max total bytes for a statementPages request (sum) — 30 MiB */
  MAX_TOTAL_UPLOAD_BYTES: 30 * 1024 * 1024,
  /** Max page count for statementPages */
  MAX_PAGE_COUNT: 10,
  /** Min pages for statementPages (must be 2-10, single-page uses `statement`) */
  MIN_PAGE_COUNT: 2,
  /** Max characters of native PDF text before considered usable vs OCR */
  MIN_USABLE_NATIVE_TEXT_LENGTH: 20,
  /** Max total OCR/text length we will accept/process */
  MAX_TEXT_LENGTH: 200_000,
  /** Max OCR/text length per page (soft) */
  MAX_TEXT_LENGTH_PER_PAGE: 50_000,
  /** Max image pixel count (decompression bomb guard) — 25 MP approx 5000x5000 */
  MAX_IMAGE_PIXELS: 25_000_000,
  /** Max decoded pixels across all rendered PDF pages — 100 MP */
  MAX_PDF_RENDERED_PIXELS: 100_000_000,
  /** Width used for bounded, in-memory scanned-PDF rasterization */
  PDF_RENDER_WIDTH: 2400,
  /** Upper bound supplied to PDF.js for decoded image/canvas memory — 100 MiB */
  MAX_PDF_DECODED_BYTES: 100 * 1024 * 1024,
  // Phase 2 - Wallet history import limits (documented beside existing ingestion limits)
  /** Max Wallet history file size — 5 MiB */
  MAX_HISTORY_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  /** Max Wallet history rows (excluding header) */
  MAX_HISTORY_ROWS: 10_000,
  /** Max Wallet history decoded text length — 5 MiB chars */
  MAX_HISTORY_TEXT_LENGTH: 5 * 1024 * 1024,
  /** Max length per field in history CSV */
  MAX_HISTORY_FIELD_LENGTH: 500,
  /** Adapter identifier for history import */
  HISTORY_ADAPTER_ID: 'wallet-history-csv',
  HISTORY_ADAPTER_VERSION: '2.0.0',
  // Retrieval
  /** Max retrieved examples per transaction */
  MAX_RETRIEVED_EXAMPLES: 5,
  // Provider
  /** Max provider request body size */
  MAX_PROVIDER_REQUEST_BYTES: 64 * 1024,
  /** Max provider response size */
  MAX_PROVIDER_RESPONSE_BYTES: 64 * 1024,
  /** Lightweight provider health-check timeout ms */
  PROVIDER_TIMEOUT_MS: 5000,
  /** Local model inference can include model loading and prompt evaluation. */
  PROVIDER_INFERENCE_TIMEOUT_MS: 120_000,
  // Classification
  /** Confidence threshold below which result is low_confidence */
  CLASSIFICATION_CONFIDENCE_THRESHOLD: 0.6,
  /** Baseline exact-match confidence */
  BASELINE_CONFIDENCE: 0.95,
  // Phase 3 - Review
  /** Max payee length (bounded display field) */
  MAX_REVIEW_PAYEE_LENGTH: 200,
  /** Max note length (bounded display field) */
  MAX_REVIEW_NOTE_LENGTH: 500,
  /** Max description projection length */
  MAX_REVIEW_DESCRIPTION_LENGTH: 500,
  /** Max category name length */
  MAX_REVIEW_CATEGORY_LENGTH: 200,
  /** Max review items per session (including splits) */
  MAX_REVIEW_ITEMS: 500,
  /** Max audit events per session — reject further edits when reached */
  MAX_AUDIT_EVENTS: 500,
  /** Max payee/note lengths already enforced via zod */
  /** Max split children per parent source */
  MAX_SPLIT_CHILDREN: 10,
  /** Review duplicate detection - versioned thresholds/weights */
  DUPLICATE_VERSION: '1.0.0',
  DUPLICATE_WEIGHT_AMOUNT: 0.35,
  DUPLICATE_WEIGHT_DATE_SAME_DAY: 0.25,
  DUPLICATE_WEIGHT_DATE_WITHIN_ONE: 0.15,
  DUPLICATE_WEIGHT_DESCRIPTION_EXACT: 0.3,
  DUPLICATE_WEIGHT_REFERENCE: 0.1,
  DUPLICATE_NEAR_THRESHOLD: 0.8,
  DUPLICATE_DATE_WINDOW_DAYS: 1,
  // Phase 4 - Wallet REST commit
  /** Fixed Wallet REST origin */
  WALLET_BASE_URL: 'https://rest.budgetbakers.com/wallet' as const,
  /** Max Wallet token length (bounded password field) */
  MAX_WALLET_TOKEN_LENGTH: 500,
  /** Max Wallet response size (bounded) */
  MAX_WALLET_RESPONSE_BYTES: 512 * 1024,
  /** Wallet read/connect timeout ms */
  WALLET_TIMEOUT_MS: 10000,
  /** Wallet write timeout ms (unknown never auto-resend) */
  WALLET_WRITE_TIMEOUT_MS: 15000,
  /** Max pagination limit per Wallet spec (max 200) */
  WALLET_PAGE_LIMIT_MAX: 200,
  /** Default pagination limit */
  WALLET_PAGE_LIMIT_DEFAULT: 100,
  /** Max items per create batch (confirmed endpoint maximum) */
  WALLET_CREATE_BATCH_MAX: 100,
  /** Max categories/accounts per session catalog */
  MAX_WALLET_ACCOUNTS: 200,
  MAX_WALLET_CATEGORIES: 500,
  /** Max wallet labels length */
  MAX_WALLET_LABEL_LENGTH: 200,
  /** Max mappings per session */
  MAX_WALLET_MAPPINGS: 200,
  /** Max journal entries per session (bounded) */
  MAX_WALLET_JOURNAL_ENTRIES: 500,
  /** Max audit events for Wallet phase */
  MAX_WALLET_AUDIT_EVENTS: 500,
  /** Max dry-run snapshots per session (only one live) */
  MAX_WALLET_SNAPSHOT_PAYLOADS: 500,
  /** Wallet catalog version string max */
  MAX_WALLET_CATALOG_VERSION_LENGTH: 100,
  /** Rate-limit bounded wait max ms */
  WALLET_MAX_RETRY_AFTER_MS: 60000,
} as const;

export const REVIEW_LIMITS = {
  DUPLICATE_VERSION: '1.0.0',
  DUPLICATE_WEIGHT_AMOUNT: 0.35,
  DUPLICATE_WEIGHT_DATE_SAME_DAY: 0.25,
  DUPLICATE_WEIGHT_DATE_WITHIN_ONE: 0.15,
  DUPLICATE_WEIGHT_DESCRIPTION_EXACT: 0.3,
  DUPLICATE_WEIGHT_REFERENCE: 0.1,
  DUPLICATE_NEAR_THRESHOLD: 0.8,
  DUPLICATE_DATE_WINDOW_DAYS: 1,
} as const;

/**
 * Supported MIME types (content-signature verified). Extension is only a hint.
 * Chosen to cover CSV, PDF, and common image formats for image-only ingestion.
 */
export const SUPPORTED_MIME_TYPES = {
  CSV: 'text/csv',
  PDF: 'application/pdf',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  TIFF: 'image/tiff',
  BMP: 'image/bmp',
} as const;

export const SUPPORTED_MIMES = new Set<string>(
  Object.values(SUPPORTED_MIME_TYPES),
);

/** Extension -> MIME hint map (lowercase) */
export const EXTENSION_TO_MIME: Record<string, string> = {
  '.csv': SUPPORTED_MIME_TYPES.CSV,
  '.pdf': SUPPORTED_MIME_TYPES.PDF,
  '.jpg': SUPPORTED_MIME_TYPES.JPEG,
  '.jpeg': SUPPORTED_MIME_TYPES.JPEG,
  '.png': SUPPORTED_MIME_TYPES.PNG,
  '.webp': SUPPORTED_MIME_TYPES.WEBP,
  '.tif': SUPPORTED_MIME_TYPES.TIFF,
  '.tiff': SUPPORTED_MIME_TYPES.TIFF,
  '.bmp': SUPPORTED_MIME_TYPES.BMP,
};

/** Magic byte signatures for content-based detection */
export function detectMimeBySignature(buffer: Buffer): string | null {
  if (buffer.length === 0) return null;
  // PDF %PDF-
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return SUPPORTED_MIME_TYPES.PDF;
  }
  // PNG 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return SUPPORTED_MIME_TYPES.PNG;
  }
  // JPEG FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return SUPPORTED_MIME_TYPES.JPEG;
  }
  // GIF 47 49 46 (not supported -> null)
  // WEBP RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return SUPPORTED_MIME_TYPES.WEBP;
  }
  // BMP 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return SUPPORTED_MIME_TYPES.BMP;
  }
  // TIFF 49 49 2A 00 or 4D 4D 00 2A
  if (
    (buffer[0] === 0x49 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x2a &&
      buffer[3] === 0x00) ||
    (buffer[0] === 0x4d &&
      buffer[1] === 0x4d &&
      buffer[2] === 0x00 &&
      buffer[3] === 0x2a)
  ) {
    return SUPPORTED_MIME_TYPES.TIFF;
  }
  // CSV: heuristic — printable ASCII, contains comma/semicolon and newline, not binary
  // We treat absence of binary magic as possible CSV, but validate stricter elsewhere.
  // Return null here; CSV detection is fallback via text heuristic.
  return null;
}

export function isCsvLike(buffer: Buffer): boolean {
  // BOM tolerated
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length === 0 || text.trim().length === 0) return false;
  // Binary detection: contains null byte => not csv
  if (buffer.includes(0x00)) return false;
  // Must have at least one comma or semicolon and printable
  if (!text.includes(',') && !text.includes(';')) return false;
  // Check most chars printable or newline (allow whitespace controls tab/newline)
  // eslint-disable-next-line no-control-regex
  const nonPrintable = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) ?? [])
    .length;
  if (nonPrintable > 0) return false;
  return true;
}
