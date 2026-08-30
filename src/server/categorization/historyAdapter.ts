import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';
import { LIMITS } from '../ingestion/limits.js';
import { parsePhpAmountToMinorUnits } from '../ingestion/decimal.js';
import type { WalletHistoryRecord } from './contracts.js';

const REQUIRED_HEADERS = [
  'record_id',
  'date',
  'payee',
  'description',
  'amount',
  'currency',
  'category',
  'account',
  'source_row_id',
  'note',
] as const;

const WALLET_NATIVE_HEADERS = [
  'account',
  'category',
  'currency',
  'amount',
  'ref_currency_amount',
  'type',
  'payment_type',
  'note',
  'date',
  'transfer',
  'payee',
  'labels',
] as const;

type HistorySchema = 'synthetic' | 'wallet-native';

function sameHeaderSet(
  headers: string[],
  expected: readonly string[],
): boolean {
  const actual = new Set(headers);
  return (
    actual.size === headers.length &&
    actual.size === expected.length &&
    expected.every((header) => actual.has(header))
  );
}

function normalizeWalletAmount(raw: string): string {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) return `${trimmed}.00`;
  if (/^-?\d+\.\d$/.test(trimmed)) return `${trimmed}0`;
  return trimmed;
}

function normalizeWalletDate(raw: string): string | undefined {
  const trimmed = raw.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(trimmed);
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
    ? undefined
    : date;
}

function walletNativeRecordId(
  raw: Record<string, string>,
  rowIndex: number,
): string {
  const canonical = WALLET_NATIVE_HEADERS.map((key) => raw[key] ?? '').join(
    '\u001f',
  );
  const digest = createHash('sha256')
    .update(`${rowIndex}\u001e${canonical}`)
    .digest('hex')
    .slice(0, 24);
  return `wallet-native-${digest}`;
}

type HistoryParseResult =
  | {
      records: WalletHistoryRecord[];
      summary: {
        recordCount: number;
        categoryCount: number;
        accountCount: number;
      };
    }
  | { error: { code: string; message: string } };

export function parseHistoryCsv(buffer: Buffer): HistoryParseResult {
  // Size limits
  if (buffer.length === 0) {
    return {
      error: { code: 'history_schema_invalid', message: 'Empty history file.' },
    };
  }
  if (buffer.length > LIMITS.MAX_HISTORY_FILE_SIZE_BYTES) {
    return {
      error: {
        code: 'history_limit_exceeded',
        message: 'History file exceeds size limit.',
      },
    };
  }

  // Decode UTF-8 BOM tolerated
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  if (text.length > LIMITS.MAX_HISTORY_TEXT_LENGTH) {
    return {
      error: {
        code: 'history_limit_exceeded',
        message: 'History text exceeds limit.',
      },
    };
  }
  if (text.trim().length === 0) {
    return {
      error: {
        code: 'history_schema_invalid',
        message: 'History file is empty.',
      },
    };
  }

  let rows: Record<string, string>[] | undefined;
  let trimmedHeaders: string[] = [];
  let schema: HistorySchema | undefined;
  let lastParseMessage = 'CSV parse failed';

  for (const delimiter of [';', ',']) {
    try {
      const parsedRows = parse(text, {
        delimiter,
        columns: (headers: string[]) => headers.map((header) => header.trim()),
        skip_empty_lines: true,
        trim: false,
        relax_column_count: false,
        relax_quotes: false,
        quote: '"',
        escape: '"',
        bom: false,
        skip_records_with_error: false,
      }) as Record<string, string>[];
      const headerRows = parse(text, {
        delimiter,
        columns: false,
        skip_empty_lines: true,
        trim: false,
        relax_column_count: false,
        to_line: 1,
      }) as string[][];
      const candidateHeaders = (headerRows[0] ?? []).map((header) =>
        header.trim(),
      );
      if (sameHeaderSet(candidateHeaders, REQUIRED_HEADERS))
        schema = 'synthetic';
      if (sameHeaderSet(candidateHeaders, WALLET_NATIVE_HEADERS))
        schema = 'wallet-native';
      if (schema) {
        rows = parsedRows;
        trimmedHeaders = candidateHeaders;
        break;
      }
      if (candidateHeaders.length > trimmedHeaders.length) {
        trimmedHeaders = candidateHeaders;
      }
    } catch (error) {
      lastParseMessage = (error as Error).message ?? lastParseMessage;
    }
  }

  if (!rows || !schema) {
    const knownHeaders = new Set([
      ...REQUIRED_HEADERS,
      ...WALLET_NATIVE_HEADERS,
    ]);
    const unknown = trimmedHeaders.filter(
      (header) => !knownHeaders.has(header as never),
    );
    return {
      error: {
        code: 'history_schema_invalid',
        message:
          trimmedHeaders.length === 0
            ? `CSV parsing failed: ${lastParseMessage.slice(0, 200)}`
            : unknown.length > 0
              ? 'Unknown history header.'
              : 'Missing required history column.',
      },
    };
  }

  // Validate required set
  const headerSet = new Set(trimmedHeaders);
  if (headerSet.size !== trimmedHeaders.length) {
    return {
      error: {
        code: 'history_schema_invalid',
        message: 'Duplicate history header.',
      },
    };
  }
  // Check all required present and no unknown extra?
  // Spec: unknown schemas fail safely; do not guess columns. So require exact set.
  const activeHeaders =
    schema === 'synthetic' ? REQUIRED_HEADERS : WALLET_NATIVE_HEADERS;
  const requiredSet = new Set<string>(activeHeaders);
  if (
    headerSet.size !== requiredSet.size ||
    [...requiredSet].some((h) => !headerSet.has(h))
  ) {
    // Also if extra unknown header exists
    const unknown = [...headerSet].filter((h) => !requiredSet.has(h));
    if (unknown.length > 0) {
      return {
        error: {
          code: 'history_schema_invalid',
          message: 'Unknown history header.',
        },
      };
    }
    return {
      error: {
        code: 'history_schema_invalid',
        message: 'Missing required history column.',
      },
    };
  }

  // Row count limits
  if (rows.length === 0) {
    return {
      error: {
        code: 'history_schema_invalid',
        message: 'History has no records.',
      },
    };
  }
  if (rows.length > LIMITS.MAX_HISTORY_ROWS) {
    return {
      error: {
        code: 'history_limit_exceeded',
        message: 'History row count exceeds limit.',
      },
    };
  }

  const records: WalletHistoryRecord[] = [];
  const seenRecordIds = new Set<string>();
  const categories = new Set<string>();
  const accounts = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    // Field length check
    for (const key of activeHeaders) {
      const val = raw[key] ?? '';
      if (val.length > LIMITS.MAX_HISTORY_FIELD_LENGTH) {
        return {
          error: {
            code: 'history_limit_exceeded',
            message: `Field exceeds length limit at row ${i + 2}.`,
          },
        };
      }
    }

    const recordIdRaw =
      schema === 'wallet-native'
        ? walletNativeRecordId(raw, i)
        : (raw['record_id'] ?? '').trim();
    const nativeDate = normalizeWalletDate(raw['date'] ?? '');
    const dateRaw =
      schema === 'wallet-native'
        ? (nativeDate ?? '')
        : (raw['date'] ?? '').trim();
    const payeeRaw = (raw['payee'] ?? '').trim();
    const noteRaw = (raw['note'] ?? '').trim();
    const descriptionRaw =
      schema === 'wallet-native'
        ? noteRaw || payeeRaw || (raw['category'] ?? '').trim()
        : (raw['description'] ?? '').trim();
    const amountRaw =
      schema === 'wallet-native'
        ? normalizeWalletAmount(raw['amount'] ?? '')
        : (raw['amount'] ?? '').trim();
    const currencyRaw = (raw['currency'] ?? '').trim();
    const categoryRaw = (raw['category'] ?? '').trim();
    const accountRaw = (raw['account'] ?? '').trim();
    const sourceRowIdRaw =
      schema === 'wallet-native' ? '' : (raw['source_row_id'] ?? '').trim();

    // Validations
    if (!recordIdRaw) {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Missing record_id at row ${i + 2}.`,
        },
      };
    }
    if (seenRecordIds.has(recordIdRaw)) {
      return {
        error: {
          code: 'history_duplicate_record_id',
          message: `Duplicate record_id at row ${i + 2}.`,
        },
      };
    }
    seenRecordIds.add(recordIdRaw);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Invalid date at row ${i + 2}.`,
        },
      };
    }
    const d = new Date(dateRaw);
    if (isNaN(d.getTime())) {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Invalid date at row ${i + 2}.`,
        },
      };
    }

    if (!descriptionRaw) {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Missing description at row ${i + 2}.`,
        },
      };
    }
    if (descriptionRaw.length > 500) {
      return {
        error: {
          code: 'history_limit_exceeded',
          message: `Description too long at row ${i + 2}.`,
        },
      };
    }

    if (!amountRaw) {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Missing amount at row ${i + 2}.`,
        },
      };
    }
    let amountMinor: number;
    try {
      amountMinor = parsePhpAmountToMinorUnits(amountRaw);
    } catch {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Invalid amount at row ${i + 2}.`,
        },
      };
    }

    if (currencyRaw !== 'PHP') {
      return {
        error: {
          code: 'history_unsupported_currency',
          message: `Unsupported currency at row ${i + 2}.`,
        },
      };
    }

    if (!categoryRaw) {
      return {
        error: {
          code: 'history_invalid_record',
          message: `Missing category at row ${i + 2}.`,
        },
      };
    }
    if (categoryRaw.length > 200) {
      return {
        error: {
          code: 'history_limit_exceeded',
          message: `Category too long at row ${i + 2}.`,
        },
      };
    }

    // Optional fields bounded
    if (payeeRaw && payeeRaw.length > 200) {
      return {
        error: {
          code: 'history_limit_exceeded',
          message: `Payee too long at row ${i + 2}.`,
        },
      };
    }
    if (accountRaw && accountRaw.length > 200) {
      return {
        error: {
          code: 'history_limit_exceeded',
          message: `Account too long at row ${i + 2}.`,
        },
      };
    }
    if (sourceRowIdRaw && sourceRowIdRaw.length > 100) {
      return {
        error: {
          code: 'history_limit_exceeded',
          message: `source_row_id too long at row ${i + 2}.`,
        },
      };
    }
    if (noteRaw && noteRaw.length > 500) {
      return {
        error: {
          code: 'history_limit_exceeded',
          message: `Note too long at row ${i + 2}.`,
        },
      };
    }

    const rec: WalletHistoryRecord = {
      recordId: recordIdRaw,
      date: dateRaw,
      payee: payeeRaw || undefined,
      description: descriptionRaw,
      amountMinor,
      currency: 'PHP',
      categoryName: categoryRaw,
      accountName: accountRaw || undefined,
      sourceRowId: sourceRowIdRaw || undefined,
      note: noteRaw || undefined,
    };
    // Validate via zod (but we already checked)
    records.push(rec);
    categories.add(categoryRaw);
    if (accountRaw) accounts.add(accountRaw);
  }

  // Zero valid rows already handled (rows empty). Also need at least one category.
  if (categories.size === 0) {
    return {
      error: {
        code: 'history_empty_categories',
        message: 'History has no categories.',
      },
    };
  }

  return {
    records,
    summary: {
      recordCount: records.length,
      categoryCount: categories.size,
      accountCount: accounts.size,
    },
  };
}

export const historyAdapterMeta = {
  adapterId: LIMITS.HISTORY_ADAPTER_ID,
  adapterVersion: LIMITS.HISTORY_ADAPTER_VERSION,
};
