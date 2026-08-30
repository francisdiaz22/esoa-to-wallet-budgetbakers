import { z } from 'zod';

/**
 * Canonical issue codes — single source of truth for P1-P3.
 * Both ingestion and categorization re-export this schema to prevent drift.
 */
export const ISSUE_CODES = [
  // Phase 1
  'missing_date',
  'missing_amount',
  'invalid_decimal',
  'suspicious_balance',
  'malformed_row',
  'unsupported_layout',
  'unsupported_currency',
  'unreadable_document',
  // Phase 2
  'history_schema_invalid',
  'history_invalid_record',
  'history_unsupported_currency',
  'history_empty_categories',
  'history_not_imported',
  'history_duplicate_record_id',
  'history_limit_exceeded',
  'provider_not_configured',
  'provider_unavailable',
  'provider_malformed',
  'category_not_allowed',
  'low_classification_confidence',
  // Phase 3
  'duplicate_exact',
  'duplicate_near',
  'category_required',
  'review_not_approved',
  'split_total_mismatch',
  'split_invalid',
  'split_parent_locked',
  'review_revision_conflict',
  'reclassification_not_allowed',
  'review_limit_exceeded',
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

export const IssueCodeSchema = z.enum(ISSUE_CODES);

export const IssueSchema = z.object({
  code: IssueCodeSchema,
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1).max(500),
  relatedSourceRowIds: z.array(z.string()).optional(),
});

export type Issue = z.infer<typeof IssueSchema>;

/**
 * Whether an issue blocks approval of a review item.
 * Duplicate candidates are non-blocking warnings and must never auto-exclude.
 */
export const ISSUE_BLOCKS_APPROVAL: Record<IssueCode, boolean> = {
  // P1 errors block
  missing_date: true,
  missing_amount: true,
  invalid_decimal: true,
  suspicious_balance: false, // warning: visible but non-blocking
  malformed_row: true,
  unsupported_layout: true,
  unsupported_currency: true,
  unreadable_document: true,
  // P2
  history_schema_invalid: true,
  history_invalid_record: true,
  history_unsupported_currency: true,
  history_empty_categories: true,
  history_not_imported: true,
  history_duplicate_record_id: true,
  history_limit_exceeded: true,
  provider_not_configured: true,
  provider_unavailable: true,
  provider_malformed: true,
  category_not_allowed: true,
  low_classification_confidence: true,
  // P3
  duplicate_exact: false,
  duplicate_near: false,
  category_required: true,
  review_not_approved: false, // state, not a blocking issue per se
  split_total_mismatch: true,
  split_invalid: true,
  split_parent_locked: true,
  review_revision_conflict: true,
  reclassification_not_allowed: true,
  review_limit_exceeded: true,
};

export const ISSUE_SEVERITY: Record<IssueCode, 'info' | 'warning' | 'error'> = {
  missing_date: 'error',
  missing_amount: 'error',
  invalid_decimal: 'error',
  suspicious_balance: 'warning',
  malformed_row: 'error',
  unsupported_layout: 'error',
  unsupported_currency: 'error',
  unreadable_document: 'error',
  history_schema_invalid: 'error',
  history_invalid_record: 'error',
  history_unsupported_currency: 'error',
  history_empty_categories: 'error',
  history_not_imported: 'error',
  history_duplicate_record_id: 'error',
  history_limit_exceeded: 'error',
  provider_not_configured: 'error',
  provider_unavailable: 'error',
  provider_malformed: 'error',
  category_not_allowed: 'error',
  low_classification_confidence: 'warning',
  duplicate_exact: 'warning',
  duplicate_near: 'warning',
  category_required: 'error',
  review_not_approved: 'info',
  split_total_mismatch: 'error',
  split_invalid: 'error',
  split_parent_locked: 'error',
  review_revision_conflict: 'error',
  reclassification_not_allowed: 'error',
  review_limit_exceeded: 'error',
};

export function isBlocking(code: IssueCode): boolean {
  return ISSUE_BLOCKS_APPROVAL[code] ?? false;
}
