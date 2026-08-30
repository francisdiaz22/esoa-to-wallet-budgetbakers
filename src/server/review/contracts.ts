import { z } from 'zod';
import { IssueSchema } from '../shared/issues.js';
import { CategoryProposalSchema } from '../categorization/contracts.js';
import { LIMITS } from '../ingestion/limits.js';

const OpaqueIdSchema = z.string().uuid();
const IsoDateSchema = z.iso.date();

export const ReviewStateSchema = z.enum([
  'needs_review',
  'approved',
  'excluded',
]);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const ReviewItemKindSchema = z.enum(['source', 'split']);
export type ReviewItemKind = z.infer<typeof ReviewItemKindSchema>;

export const ExclusionReasonSchema = z.enum([
  'not_a_transaction',
  'duplicate_confirmed',
  'out_of_scope',
  'other',
]);
export type ExclusionReason = z.infer<typeof ExclusionReasonSchema>;

export const DuplicateMatchSchema = z.object({
  candidateReviewItemId: OpaqueIdSchema,
  candidateSourceRowId: z.string().min(1).max(100),
  matchKind: z.enum(['exact', 'near']),
  score: z.number().min(0).max(1).finite(),
  matchedSignals: z
    .array(z.enum(['date', 'amount', 'description', 'reference']))
    .min(1)
    .max(4),
});
export type DuplicateMatch = z.infer<typeof DuplicateMatchSchema>;

export const ReviewItemSchema = z
  .object({
    reviewItemId: OpaqueIdSchema,
    kind: ReviewItemKindSchema,
    sourceRowId: z.string().min(1).max(100),
    parentReviewItemId: OpaqueIdSchema.optional(),
    amountMinor: z.number().int().finite(),
    date: IsoDateSchema,
    description: z.string().min(1).max(LIMITS.MAX_REVIEW_DESCRIPTION_LENGTH),
    payee: z.string().min(1).max(LIMITS.MAX_REVIEW_PAYEE_LENGTH).optional(),
    note: z.string().min(1).max(LIMITS.MAX_REVIEW_NOTE_LENGTH).optional(),
    categoryName: z
      .string()
      .min(1)
      .max(LIMITS.MAX_REVIEW_CATEGORY_LENGTH)
      .optional(),
    reviewState: ReviewStateSchema,
    exclusionReason: ExclusionReasonSchema.optional(),
    proposal: CategoryProposalSchema,
    duplicateMatches: z.array(DuplicateMatchSchema).max(20),
    issues: z.array(IssueSchema),
    revision: z.number().int().min(0),
  })
  .superRefine((data, ctx) => {
    // split lineage validation
    if (data.kind === 'split' && !data.parentReviewItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'split child must have parentReviewItemId',
        path: ['parentReviewItemId'],
      });
    }
    if (data.kind === 'source' && data.parentReviewItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'source item must not have parentReviewItemId',
        path: ['parentReviewItemId'],
      });
    }
    // exclusion reason only for excluded
    if (data.reviewState === 'excluded' && !data.exclusionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'excluded requires exclusionReason',
        path: ['exclusionReason'],
      });
    }
    if (data.reviewState !== 'excluded' && data.exclusionReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exclusionReason only for excluded',
        path: ['exclusionReason'],
      });
    }
    if (
      data.reviewState === 'approved' &&
      (!data.categoryName || data.categoryName === 'unknown')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'approved item requires a concrete category',
        path: ['categoryName'],
      });
    }
  });

export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const ReviewSummarySchema = z.object({
  totalItems: z.number().int().min(0),
  sourceChargeCount: z.number().int().min(0),
  approvedCount: z.number().int().min(0),
  excludedCount: z.number().int().min(0),
  needsReviewCount: z.number().int().min(0),
  blockingCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  duplicateCandidateCount: z.number().int().min(0),
  splitSourceCount: z.number().int().min(0),
  approvedExpenseTotalMinor: z.number().int().finite(),
});
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;

export const ReviewAuditEventSchema = z.object({
  eventId: OpaqueIdSchema,
  occurredAt: z.iso.datetime({ offset: false }),
  action: z.enum([
    'review_initialized',
    'category_changed',
    'payee_changed',
    'note_changed',
    'approved',
    'excluded',
    'split_created',
    'split_updated',
    'split_removed',
    'recategorized',
    'returned_to_review',
  ]),
  reviewItemId: OpaqueIdSchema.optional(),
  sourceRowId: z.string().min(1).max(100),
  safeDetails: z.record(
    z.string().min(1).max(100),
    z.union([
      z.string().max(200),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(200)).max(20),
    ]),
  ),
});
export type ReviewAuditEvent = z.infer<typeof ReviewAuditEventSchema>;

export const ApprovedReviewItemForCommitSchema = z.object({
  reviewItemId: OpaqueIdSchema,
  sourceRowId: z.string().min(1).max(100),
  date: IsoDateSchema,
  amountMinor: z.number().int().finite(),
  currency: z.literal('PHP'),
  description: z.string().min(1).max(500),
  payee: z.string().min(1).max(200).optional(),
  note: z.string().min(1).max(500).optional(),
  categoryName: z.string().min(1).max(200),
  sourceReference: z.string().min(1).max(200).optional(),
  splitParentReviewItemId: OpaqueIdSchema.optional(),
});
export type ApprovedReviewItemForCommit = z.infer<
  typeof ApprovedReviewItemForCommitSchema
>;

// For API request validation
export const ReviewInitializeResponseSchema = z.object({
  items: z.array(ReviewItemSchema),
  summary: ReviewSummarySchema,
  reviewVersion: z.number().int().min(1),
});

export const ReviewPatchBodySchema = z
  .object({
    revision: z.number().int().min(0),
    categoryName: z.string().min(1).max(200).optional(),
    payee: z.string().max(200).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    // unknown fields rejected by strict
  })
  .strict();

export const ReviewExcludeBodySchema = z
  .object({
    revision: z.number().int().min(0),
    exclusionReason: ExclusionReasonSchema,
    note: z.string().min(1).max(500).optional(),
  })
  .strict();

export const ReviewSplitBodySchema = z
  .object({
    revision: z.number().int().min(0),
    splits: z
      .array(
        z
          .object({
            amountMinor: z.number().int().finite(),
            categoryName: z.string().min(1).max(200),
            payee: z.string().min(1).max(200).optional(),
            note: z.string().min(1).max(500).optional(),
            description: z.string().min(1).max(500).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(LIMITS.MAX_SPLIT_CHILDREN),
  })
  .strict();

export const ReviewBulkApproveBodySchema = z
  .object({
    reviewVersion: z.number().int().min(1),
  })
  .strict();

export const ReviewReclassifyBodySchema = z
  .object({
    revision: z.number().int().min(0),
  })
  .strict();

export const ReviewRevisionBodySchema = z
  .object({ revision: z.number().int().min(0) })
  .strict();
