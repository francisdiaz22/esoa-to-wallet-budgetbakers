import { z } from 'zod';
import {
  IssueSchema,
  IssueCodeSchema as SharedIssueCodeSchema,
} from '../shared/issues.js';
export { IssueSchema, SharedIssueCodeSchema as CategorizationIssueCodeSchema };
export type { Issue } from '../shared/issues.js';

export const WalletHistoryRecordSchema = z.object({
  recordId: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payee: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(500),
  amountMinor: z.number().int().finite(),
  currency: z.literal('PHP'),
  categoryName: z.string().min(1).max(200),
  accountName: z.string().min(1).max(200).optional(),
  sourceRowId: z.string().min(1).max(100).optional(),
  note: z.string().min(1).max(500).optional(),
});
export type WalletHistoryRecord = z.infer<typeof WalletHistoryRecordSchema>;

export const CategoryCatalogEntrySchema = z.object({
  categoryId: z.string().min(1).max(200),
  categoryName: z.string().min(1).max(200),
  exampleCount: z.number().int().min(0),
});
export type CategoryCatalogEntry = z.infer<typeof CategoryCatalogEntrySchema>;

export const RetrievedExampleSchema = z.object({
  historyRecordId: z.string().min(1).max(100),
  categoryName: z.string().min(1).max(200),
  payee: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(500),
  amountMinor: z.number().int().finite(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  score: z.number().min(0).max(1).finite(),
});
export type RetrievedExample = z.infer<typeof RetrievedExampleSchema>;

export const ClassificationOutcomeSchema = z.enum([
  'proposed',
  'unknown',
  'low_confidence',
  'provider_unavailable',
  'provider_malformed',
]);
export type ClassificationOutcome = z.infer<typeof ClassificationOutcomeSchema>;

const CategoryProposalBaseSchema = z.object({
  proposalId: z.string().min(1).max(200),
  sourceRowId: z.string().min(1).max(100),
  classificationConfidence: z.number().min(0).max(1).finite(),
  rationale: z.string().min(1).max(500),
  reviewState: z.literal('needs_review'),
  retrieval: z.array(RetrievedExampleSchema).max(5),
  issues: z.array(IssueSchema),
});

export const CategoryProposalSchema = z.discriminatedUnion('outcome', [
  CategoryProposalBaseSchema.extend({
    outcome: z.literal('proposed'),
    categoryName: z.string().min(1).max(200),
  }),
  CategoryProposalBaseSchema.extend({
    outcome: z.literal('unknown'),
    categoryName: z.never().optional(),
  }),
  CategoryProposalBaseSchema.extend({
    outcome: z.enum([
      'low_confidence',
      'provider_unavailable',
      'provider_malformed',
    ]),
    categoryName: z.string().min(1).max(200).optional(),
  }),
]);
export type CategoryProposal = z.infer<typeof CategoryProposalSchema>;

export const CategorizationResultSchema = z.object({
  sessionId: z.string().min(1).max(200),
  historyVersion: z.number().int().min(1),
  proposals: z.array(CategoryProposalSchema),
  summary: z.object({
    total: z.number().int().min(0),
    byOutcome: z.record(ClassificationOutcomeSchema, z.number().int().min(0)),
  }),
});

export type CategorizationResult = z.infer<typeof CategorizationResultSchema>;

export const HistoryImportSummarySchema = z.object({
  recordCount: z.number().int().min(0),
  categoryCount: z.number().int().min(0),
  accountCount: z.number().int().min(0),
  adapterId: z.string().min(1).max(100),
  adapterVersion: z.string().min(1).max(50),
  historyVersion: z.number().int().min(1),
});

export type HistoryImportSummary = z.infer<typeof HistoryImportSummarySchema>;

export const ProviderConfigSchema = z.object({
  baseUrl: z.string().min(1).max(500),
  model: z.string().min(1).max(200).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProviderConfigSafeSchema = z.object({
  baseUrl: z.string().min(1).max(500),
  model: z.string().min(1).max(200).optional(),
  configured: z.boolean(),
  lastTestedAt: z.string().optional(),
  lastTestOk: z.boolean().optional(),
});
export type ProviderConfigSafe = z.infer<typeof ProviderConfigSafeSchema>;
