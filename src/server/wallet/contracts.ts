import { z } from 'zod';
import { LIMITS } from '../ingestion/limits.js';

export const WalletConnectionStateSchema = z.enum([
  'not_configured',
  'ready',
  'initial_sync_pending',
  'unauthorized',
  'rate_limited',
  'unavailable',
]);
export type WalletConnectionState = z.infer<typeof WalletConnectionStateSchema>;

export const CommitItemStatusSchema = z.enum([
  'ready',
  'submitting',
  'succeeded',
  'client_error',
  'server_error_retryable',
  'unknown',
  'not_submitted',
]);
export type CommitItemStatus = z.infer<typeof CommitItemStatusSchema>;

const BoundedLabelSchema = z
  .string()
  .min(1)
  .max(LIMITS.MAX_WALLET_LABEL_LENGTH);
const OpaqueIdSchema = z.string().min(1).max(200);
const IsoDatetimeSchema = z.iso.datetime({ offset: true });

// WalletAccount projection (remote)
export const WalletAccountSchema = z
  .object({
    id: OpaqueIdSchema,
    name: BoundedLabelSchema,
    currency: z.literal('PHP'),
    writable: z.boolean(),
    // additional but bounded; strict will strip unknown but we reject unknownFields per spec => use superRefine? Instead use strict
    type: z.string().min(1).max(50).optional(),
  })
  .strict();
export type WalletAccount = z.infer<typeof WalletAccountSchema>;

// Safe projection exposed via API (bounded labels only)
export const WalletAccountSafeSchema = z
  .object({
    walletAccountId: OpaqueIdSchema,
    walletAccountLabel: BoundedLabelSchema,
    currency: z.literal('PHP'),
    writable: z.boolean(),
  })
  .strict();
export type WalletAccountSafe = z.infer<typeof WalletAccountSafeSchema>;

export const WalletCategorySchema = z
  .object({
    id: OpaqueIdSchema,
    name: BoundedLabelSchema,
    parentId: OpaqueIdSchema.optional(),
    isGroup: z.boolean().optional(),
  })
  .strict();
export type WalletCategory = z.infer<typeof WalletCategorySchema>;

export const WalletCategorySafeSchema = z
  .object({
    walletCategoryId: OpaqueIdSchema,
    walletCategoryLabel: BoundedLabelSchema,
    parentId: OpaqueIdSchema.optional(),
    isGroup: z.boolean().optional(),
  })
  .strict();
export type WalletCategorySafe = z.infer<typeof WalletCategorySafeSchema>;

export const WalletCategoryMappingSchema = z
  .object({
    localCategoryName: z.string().min(1).max(LIMITS.MAX_REVIEW_CATEGORY_LENGTH),
    walletCategoryId: OpaqueIdSchema,
    walletCategoryLabel: BoundedLabelSchema,
    catalogVersion: z
      .string()
      .min(1)
      .max(LIMITS.MAX_WALLET_CATALOG_VERSION_LENGTH),
  })
  .strict();
export type WalletCategoryMapping = z.infer<typeof WalletCategoryMappingSchema>;

export const CommitJournalEntrySchema = z
  .object({
    reviewItemId: z.string().uuid(),
    sourceRowId: z.string().min(1).max(100),
    snapshotId: z.string().uuid(),
    inputIndex: z
      .number()
      .int()
      .min(0)
      .max(LIMITS.MAX_WALLET_SNAPSHOT_PAYLOADS)
      .optional(),
    status: CommitItemStatusSchema,
    walletRecordId: OpaqueIdSchema.optional(),
    safeErrorCode: z.string().min(1).max(100).optional(),
    attemptCount: z.number().int().min(0).max(100),
    updatedAt: IsoDatetimeSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === 'succeeded' && !data.walletRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'succeeded requires walletRecordId',
        path: ['walletRecordId'],
      });
    }
    // success is terminal; only server_error_retryable may return to submitting — validated at service level, but schema enforces shape
  });
export type CommitJournalEntry = z.infer<typeof CommitJournalEntrySchema>;

// Canonical Wallet create payload (exactly what adapter produces, no floats)
export const WalletRecordCreateSchema = z
  .object({
    accountId: OpaqueIdSchema,
    categoryId: OpaqueIdSchema,
    amount: z.number().int().finite(), // signed minor centavos preserved; adapter maps once
    currency: z.literal('PHP'),
    date: z.iso.date(),
    description: z.string().min(1).max(500),
    payee: z.string().min(1).max(200).optional(),
    note: z.string().min(1).max(500).optional(),
    reference: z.string().min(1).max(200).optional(),
  })
  .strict();
export type WalletRecordCreate = z.infer<typeof WalletRecordCreateSchema>;

export const WalletWriteRequestSchema = z
  .object({
    records: z
      .array(WalletRecordCreateSchema)
      .min(1)
      .max(LIMITS.WALLET_CREATE_BATCH_MAX),
  })
  .strict();
export type WalletWriteRequest = z.infer<typeof WalletWriteRequestSchema>;

// Per-item result from Wallet
export const WalletWriteResultSchema = z
  .object({
    inputIndex: z
      .number()
      .int()
      .min(0)
      .max(LIMITS.WALLET_CREATE_BATCH_MAX * 10),
    status: z.enum(['succeeded', 'client_error', 'server_error']),
    walletRecordId: OpaqueIdSchema.optional(),
    safeErrorCode: z.string().min(1).max(100).optional(),
    message: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.status === 'succeeded' && !data.walletRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'success requires walletRecordId',
        path: ['walletRecordId'],
      });
    }
    if (data.status !== 'succeeded' && data.walletRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-success must not have walletRecordId',
        path: ['walletRecordId'],
      });
    }
  });
export type WalletWriteResult = z.infer<typeof WalletWriteResultSchema>;

export const WalletWriteEnvelopeSchema = z
  .object({
    summary: z
      .object({
        total: z.number().int().min(0),
        succeeded: z.number().int().min(0),
        failed: z.number().int().min(0),
      })
      .strict(),
    results: z
      .array(WalletWriteResultSchema)
      .min(1)
      .max(LIMITS.WALLET_CREATE_BATCH_MAX),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.summary.total !== data.results.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'summary.total must equal results length',
        path: ['summary', 'total'],
      });
    }
    if (data.summary.succeeded + data.summary.failed !== data.summary.total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'summary counts mismatch',
        path: ['summary'],
      });
    }
    const indexes = data.results.map((r) => r.inputIndex);
    if (new Set(indexes).size !== indexes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate inputIndex',
        path: ['results'],
      });
    }
    for (const idx of indexes) {
      if (idx < 0 || idx >= data.results.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'inputIndex out of range',
          path: ['results'],
        });
        break;
      }
    }
  });
export type WalletWriteEnvelope = z.infer<typeof WalletWriteEnvelopeSchema>;

// Paginated list envelopes (validated before atomic catalog replace)
export const WalletAccountListEnvelopeSchema = z
  .object({
    accounts: z.array(WalletAccountSchema).max(LIMITS.WALLET_PAGE_LIMIT_MAX),
    pagination: z
      .object({
        limit: z.number().int().min(1).max(LIMITS.WALLET_PAGE_LIMIT_MAX),
        offset: z.number().int().min(0),
        nextOffset: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WalletAccountListEnvelope = z.infer<
  typeof WalletAccountListEnvelopeSchema
>;

export const WalletCategoryListEnvelopeSchema = z
  .object({
    categories: z.array(WalletCategorySchema).max(LIMITS.WALLET_PAGE_LIMIT_MAX),
    pagination: z
      .object({
        limit: z.number().int().min(1).max(LIMITS.WALLET_PAGE_LIMIT_MAX),
        offset: z.number().int().min(0),
        nextOffset: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type WalletCategoryListEnvelope = z.infer<
  typeof WalletCategoryListEnvelopeSchema
>;

// Snapshot stored server-side (opaque to client)
export const WalletSnapshotSchema = z
  .object({
    snapshotId: z.string().uuid(),
    createdAt: IsoDatetimeSchema,
    catalogVersion: z
      .string()
      .min(1)
      .max(LIMITS.MAX_WALLET_CATALOG_VERSION_LENGTH),
    accountId: OpaqueIdSchema,
    accountLabel: BoundedLabelSchema,
    mappings: z
      .array(WalletCategoryMappingSchema)
      .min(1)
      .max(LIMITS.MAX_WALLET_MAPPINGS),
    orderedReviewItemIds: z
      .array(z.string().uuid())
      .min(1)
      .max(LIMITS.MAX_WALLET_SNAPSHOT_PAYLOADS),
    totalMinor: z.number().int().finite(),
    count: z.number().int().min(1).max(LIMITS.MAX_WALLET_SNAPSHOT_PAYLOADS),
    // Hashes for invalidation detection: map reviewItemId -> field hash
    fieldHashes: z.record(z.string().uuid(), z.string().min(1).max(200)),
    leafIdsHash: z.string().min(1).max(200),
    reviewVersion: z.number().int().min(1),
    historyVersion: z.number().int().min(1),
    tokenGeneration: z.string().min(1).max(100),
    // canonical payloads indexed by reviewItemId
    payloads: z.record(z.string().uuid(), WalletRecordCreateSchema),
  })
  .strict();
export type WalletSnapshot = z.infer<typeof WalletSnapshotSchema>;

// Safe dry-run response (never reveals hidden payload fields)
export const WalletDryRunResponseSchema = z
  .object({
    snapshotId: z.string().uuid(),
    count: z.number().int().min(1),
    totalMinor: z.number().int().finite(),
    accountLabel: BoundedLabelSchema,
    catalogVersion: z
      .string()
      .min(1)
      .max(LIMITS.MAX_WALLET_CATALOG_VERSION_LENGTH),
    coverage: z
      .object({
        localCategoryCount: z.number().int().min(1),
        mappedCount: z.number().int().min(1),
        fullyMapped: z.boolean(),
      })
      .strict(),
    items: z.array(
      z
        .object({
          reviewItemId: z.string().uuid(),
          sourceRowId: z.string().min(1).max(100),
          date: z.iso.date(),
          amountMinor: z.number().int().finite(),
          description: z.string().min(1).max(200),
          categoryName: z.string().min(1).max(200),
          walletCategoryLabel: BoundedLabelSchema,
          splitParentReviewItemId: z.string().uuid().optional(),
        })
        .strict(),
    ),
    notSentYet: z.literal(true),
    createdAt: IsoDatetimeSchema,
  })
  .strict();
export type WalletDryRunResponse = z.infer<typeof WalletDryRunResponseSchema>;

// Safe audit event for wallet (bounded, non-sensitive)
export const WalletAuditEventSchema = z
  .object({
    eventId: z.string().uuid(),
    occurredAt: IsoDatetimeSchema,
    action: z.enum([
      'wallet_connected',
      'wallet_disconnected',
      'wallet_selection_saved',
      'wallet_dry_run_created',
      'wallet_commit_started',
      'wallet_commit_chunk_succeeded',
      'wallet_commit_chunk_failed',
      'wallet_retry',
    ]),
    safeDetails: z.record(
      z.string().min(1).max(100),
      z.union([z.string().max(200), z.number().finite(), z.boolean()]),
    ),
  })
  .strict();
export type WalletAuditEvent = z.infer<typeof WalletAuditEventSchema>;

// Connection safe projection
export const WalletConnectionSafeSchema = z
  .object({
    state: WalletConnectionStateSchema,
    catalogVersion: z
      .string()
      .min(1)
      .max(LIMITS.MAX_WALLET_CATALOG_VERSION_LENGTH)
      .optional(),
    accountCount: z.number().int().min(0).optional(),
    categoryCount: z.number().int().min(0).optional(),
    retryAfterMs: z
      .number()
      .int()
      .min(0)
      .max(LIMITS.WALLET_MAX_RETRY_AFTER_MS)
      .optional(),
    retryAfterAt: IsoDatetimeSchema.optional(),
    initialSyncRetryMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .strict();
export type WalletConnectionSafe = z.infer<typeof WalletConnectionSafeSchema>;

// Token schema (password field) - never echoed
export const WalletTokenSchema = z
  .string()
  .min(10)
  .max(LIMITS.MAX_WALLET_TOKEN_LENGTH)
  .regex(/^[A-Za-z0-9\-_.]+$/);
