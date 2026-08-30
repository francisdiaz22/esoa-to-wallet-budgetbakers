import { createHash } from 'node:crypto';
import type { WalletHistoryRecord, CategoryCatalogEntry } from './contracts.js';

export function normalizeCategory(raw: string): string {
  // Unicode normalize NFKC, trim, collapse whitespace
  const normalized = raw.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return normalized;
}

export function normalizedCategoryKey(raw: string): string {
  return normalizeCategory(raw).toLocaleLowerCase('en');
}

export function stableCategoryId(normalizedKey: string): string {
  const hash = createHash('sha256')
    .update(normalizedKey)
    .digest('hex')
    .slice(0, 12);
  const slug =
    normalizedKey.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cat';
  return `cat-${slug.slice(0, 30)}-${hash}`;
}

export function buildCatalog(
  records: WalletHistoryRecord[],
):
  | { catalog: CategoryCatalogEntry[] }
  | { error: { code: string; message: string } } {
  const map = new Map<string, { canonical: string; count: number }>();
  for (const r of records) {
    const canonical = normalizeCategory(r.categoryName);
    const key = canonical.toLocaleLowerCase('en');
    if (!canonical) {
      return {
        error: {
          code: 'history_invalid_record',
          message: 'Empty category after normalization.',
        },
      };
    }
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { canonical, count: 1 });
    } else {
      if (existing.canonical !== canonical) {
        // Ambiguous case/whitespace variant
        return {
          error: {
            code: 'history_schema_invalid',
            message: `Ambiguous category variant: "${existing.canonical}" vs "${canonical}"`,
          },
        };
      }
      existing.count += 1;
    }
  }
  const catalog: CategoryCatalogEntry[] = [];
  for (const [key, v] of map.entries()) {
    catalog.push({
      categoryId: stableCategoryId(key),
      categoryName: v.canonical,
      exampleCount: v.count,
    });
  }
  // sort by categoryName for determinism
  catalog.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  return { catalog };
}
