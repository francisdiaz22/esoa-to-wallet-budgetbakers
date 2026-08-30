import { z } from 'zod';
import { IssueSchema } from '../shared/issues.js';
export { IssueSchema };
export type { Issue } from '../shared/issues.js';

export type SourceFormat = 'csv' | 'pdf-text' | 'ocr';
export type IngestionStage =
  | 'received'
  | 'validated'
  | 'extracting'
  | 'parsing'
  | 'normalizing'
  | 'complete'
  | 'failed'
  | 'cleared';

export const SourceFormatSchema = z.enum(['csv', 'pdf-text', 'ocr']);
export const IngestionStageSchema = z.enum([
  'received',
  'validated',
  'extracting',
  'parsing',
  'normalizing',
  'complete',
  'failed',
  'cleared',
]);

export const SourceLocationSchema = z.object({
  format: SourceFormatSchema,
  bankParserId: z.string().min(1).max(100),
  page: z.number().int().min(1).optional(),
  row: z.number().int().min(1).optional(),
  rawText: z.string().min(1).max(2000),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const ExtractedTransactionSchema = z.object({
  sourceRowId: z.string().min(1).max(100),
  statementId: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(500),
  amount: z.number().finite(),
  currency: z.literal('PHP'),
  balance: z.number().finite().optional(),
  reference: z.string().min(1).max(200).optional(),
  source: SourceLocationSchema,
  extractionConfidence: z.number().min(0).max(1).finite(),
  issues: z.array(IssueSchema),
});

export type ExtractedTransaction = z.infer<typeof ExtractedTransactionSchema>;

export const ExcludedSourceRowSchema = z.object({
  sourceRowId: z.string().min(1).max(100),
  page: z.number().int().min(1).optional(),
  rawText: z.string().min(1).max(2000),
  exclusionReason: z.enum([
    'previous-balance',
    'credit-card-payment',
    'summary',
    'other',
  ]),
});

export type ExcludedSourceRow = z.infer<typeof ExcludedSourceRowSchema>;

export const ExtractionResultSchema = z.object({
  sessionId: z.string().min(1).max(200),
  parserId: z.string().min(1).max(100),
  statementId: z.string().min(1).max(100).optional(),
  sourceFormat: SourceFormatSchema,
  transactions: z.array(ExtractedTransactionSchema),
  excludedRows: z.array(ExcludedSourceRowSchema),
  issues: z.array(IssueSchema),
  summary: z.object({
    proposedCount: z.number().int().min(0),
    excludedCount: z.number().int().min(0),
    expenseTotal: z.number().finite(),
  }),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// DocumentPage / TextLine neutral representation (extractor output)
export type TextLine = {
  page: number; // 1-based
  order: number; // 1-based order in document (global reading order)
  text: string;
  confidence?: number; // [0,1] if OCR
};

export type ExtractedDocument = {
  sourceFormat: SourceFormat;
  pages: number;
  lines: TextLine[];
  // raw excerpt length guard
  textLength: number;
};

export type ParserMatch = {
  matched: boolean;
  score: number; // [0,1]
  reason: string;
  parserId?: string;
};

export type ParserContext = {
  statementId: string;
  statementYear: number; // derived from statement evidence or validated metadata
  currency: 'PHP';
};

export type ParsedStatement = {
  parserId: string;
  statementId: string;
  sourceFormat: SourceFormat;
  transactions: ExtractedTransaction[];
  excludedRows: ExcludedSourceRow[];
  issues: import('../shared/issues.js').Issue[];
  /** Number of source lines recognized as transaction/exclusion candidates. */
  recognizedCandidateCount: number;
};

// Error envelope for API
export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  stage: z.string().optional(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
