import { parse } from 'csv-parse/sync';
import type {
  ExtractedDocument,
  ExtractedTransaction,
  Issue,
  ParsedStatement,
  ParserContext,
  ParserMatch,
} from './contracts.js';
import type { BankParser } from './bdoParser.js';
import { minorUnitsToAmount, toExpenseMinorUnits } from './decimal.js';

const PARSER_ID = 'unionbank-ph-csv-v1';
const HEADER = ['DATE', 'DESCRIPTION', 'CURRENCY', 'AMOUNT'];

function parseCsvLine(text: string): string[] | null {
  try {
    const rows = parse(text, {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as string[][];
    return rows.length === 1 ? rows[0] : null;
  } catch {
    return null;
  }
}

function isUnionBankHeader(row: string[]): boolean {
  return HEADER.every(
    (value, index) => row[index]?.trim().toUpperCase() === value,
  );
}

export function parseUnionBankDate(raw: string): string {
  const match = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error('invalid UnionBank date');
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('impossible UnionBank date');
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseUnionBankAmountToMinorUnits(raw: string): number {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(-?)(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('invalid UnionBank amount');
  const whole = Number(match[2].replaceAll(',', ''));
  const fraction = Number((match[3] ?? '').padEnd(2, '0'));
  const minor = whole * 100 + fraction;
  if (!Number.isSafeInteger(minor))
    throw new Error('UnionBank amount overflow');
  return match[1] === '-' ? -minor : minor;
}

export class UnionBankPhCsvParser implements BankParser {
  readonly id = PARSER_ID;

  canParse(document: ExtractedDocument): ParserMatch {
    if (document.sourceFormat !== 'csv') {
      return {
        matched: false,
        score: 0,
        reason: 'UnionBank parser only supports CSV',
      };
    }
    const header = document.lines
      .map((line) => parseCsvLine(line.text))
      .find((row): row is string[] => row !== null && isUnionBankHeader(row));
    if (!header) {
      return {
        matched: false,
        score: 0.1,
        reason: 'UnionBank CSV header not found',
      };
    }
    const candidateCount = document.lines.filter((line) => {
      const row = parseCsvLine(line.text);
      return row !== null && /^\d{2}\/\d{2}\/\d{4}$/.test(row[0]?.trim() ?? '');
    }).length;
    const score = candidateCount > 0 ? 0.99 : 0.6;
    return {
      matched: true,
      score,
      reason: `UnionBank CSV header and ${candidateCount} transaction rows found`,
      parserId: this.id,
    };
  }

  parse(document: ExtractedDocument, context: ParserContext): ParsedStatement {
    const transactions: ExtractedTransaction[] = [];
    const excludedRows: ParsedStatement['excludedRows'] = [];
    const issues: Issue[] = [];
    let recognizedCandidateCount = 0;
    let includedCount = 0;
    let excludedCount = 0;

    for (const line of [...document.lines].sort((a, b) => a.order - b.order)) {
      const row = parseCsvLine(line.text);
      if (!row || isUnionBankHeader(row)) continue;
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(row[0]?.trim() ?? '')) continue;
      recognizedCandidateCount++;

      const description = row[1]?.trim().replace(/\s+/g, ' ') ?? '';
      const currency = row[2]?.trim().toUpperCase() ?? '';
      let date: string;
      let amountMinor: number;
      try {
        date = parseUnionBankDate(row[0]);
        amountMinor = parseUnionBankAmountToMinorUnits(row[3] ?? '');
      } catch {
        issues.push({
          code: 'malformed_row',
          severity: 'error',
          message: 'A UnionBank transaction row could not be parsed safely.',
          relatedSourceRowIds: [],
        });
        continue;
      }
      if (!description || currency !== context.currency || amountMinor === 0) {
        issues.push({
          code:
            currency !== context.currency
              ? 'unsupported_currency'
              : 'malformed_row',
          severity: 'error',
          message:
            'A UnionBank transaction row contains unsupported or missing values.',
          relatedSourceRowIds: [],
        });
        continue;
      }

      if (amountMinor < 0) {
        excludedCount++;
        excludedRows.push({
          sourceRowId: `p1-x${String(excludedCount).padStart(3, '0')}`,
          page: 1,
          rawText: line.text,
          exclusionReason: 'other',
        });
        continue;
      }

      includedCount++;
      const sourceRowId = `p1-r${String(includedCount).padStart(3, '0')}`;
      transactions.push({
        sourceRowId,
        statementId: context.statementId,
        date,
        description,
        amount: minorUnitsToAmount(toExpenseMinorUnits(amountMinor)),
        currency: 'PHP',
        source: {
          format: 'csv',
          bankParserId: this.id,
          page: 1,
          row: line.order,
          rawText: line.text,
        },
        extractionConfidence: 1,
        issues: [],
      });
    }

    return {
      parserId: this.id,
      statementId: context.statementId,
      sourceFormat: document.sourceFormat,
      transactions,
      excludedRows,
      issues,
      recognizedCandidateCount,
    };
  }
}

export const unionBankCsvParser = new UnionBankPhCsvParser();
