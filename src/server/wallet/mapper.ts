import {
  WalletRecordCreateSchema,
  type WalletRecordCreate,
} from './contracts.js';
import type { ApprovedReviewItemForCommit } from '../review/contracts.js';

// Single adapter that alone translates money/date/sign fields and validates exact create schema.
// Keep signed integer amountMinor until this mapper.

export type MapperError = { code: string; message: string };

export function mapApprovedToRecord(
  item: ApprovedReviewItemForCommit,
  walletAccountId: string,
  walletCategoryId: string,
): { record: WalletRecordCreate } | { error: MapperError } {
  // Validate required mapping presence already checked upstream; here we just produce payload
  // Preserve signed amountMinor exactly; no float conversion
  // Map date as ISO calendar date; already validated
  // Use bounded fields directly
  const candidate = {
    accountId: walletAccountId,
    categoryId: walletCategoryId,
    amount: item.amountMinor,
    currency: 'PHP' as const,
    date: item.date,
    description: item.description.slice(0, 500),
    payee: item.payee?.slice(0, 200),
    note: item.note?.slice(0, 500),
    reference: item.sourceReference?.slice(0, 200),
  };
  // Remove undefined optional fields to keep strict validation clean (undefined allowed but missing is cleaner)
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (v !== undefined) cleaned[k] = v;
  }
  // Restore required fields that may have been removed incorrectly
  cleaned.accountId = candidate.accountId;
  cleaned.categoryId = candidate.categoryId;
  cleaned.amount = candidate.amount;
  cleaned.currency = candidate.currency;
  cleaned.date = candidate.date;
  cleaned.description = candidate.description;

  const parsed = WalletRecordCreateSchema.safeParse(cleaned);
  if (!parsed.success) {
    return {
      error: {
        code: 'mapper_invalid_payload',
        message: parsed.error.issues
          .map((i) => i.message)
          .join('; ')
          .slice(0, 500),
      },
    };
  }
  return { record: parsed.data };
}

export function mapBatch(
  items: ApprovedReviewItemForCommit[],
  accountId: string,
  categoryMap: Map<string, string>,
):
  | {
      records: WalletRecordCreate[];
      orderedItems: ApprovedReviewItemForCommit[];
    }
  | { error: MapperError } {
  // Deterministic order: stable source order then split-child order
  // Caller already provides items in correct order; we just map preserving order.
  // Validate every item has mapping
  for (const it of items) {
    if (!categoryMap.has(it.categoryName)) {
      return {
        error: {
          code: 'mapping_missing',
          message: `Missing mapping for ${it.categoryName}`,
        },
      };
    }
  }
  const records: WalletRecordCreate[] = [];
  for (const it of items) {
    const catId = categoryMap.get(it.categoryName)!;
    const res = mapApprovedToRecord(it, accountId, catId);
    if ('error' in res) return { error: res.error };
    records.push(res.record);
  }
  return { records, orderedItems: items };
}

// For snapshot hashing: produce canonical field hash per item (deterministic)
import { createHash } from 'node:crypto';

export function hashCanonicalFields(
  item: ApprovedReviewItemForCommit,
  accountId: string,
  categoryId: string,
): string {
  // Use session-only comparison digest of relevant fields: accountId, categoryId, amountMinor, date, description, payee, note, reference
  // Exclude transient IDs? Include reviewItemId for leaf identity but also parent lineage
  const payload = JSON.stringify({
    accountId,
    categoryId,
    amountMinor: item.amountMinor,
    date: item.date,
    description: item.description,
    payee: item.payee ?? '',
    note: item.note ?? '',
    reference: item.sourceReference ?? '',
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function hashLeafIds(orderedIds: string[]): string {
  const payload = orderedIds.join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
