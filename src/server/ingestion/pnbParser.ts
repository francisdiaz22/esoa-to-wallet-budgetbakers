import type {
  ExtractedDocument,
  ExtractedTransaction,
  ExcludedSourceRow,
  Issue,
  ParserContext,
  ParserMatch,
  ParsedStatement,
} from './contracts.js';
import type { BankParser } from './bdoParser.js';
import {
  minorUnitsToAmount,
  parsePhpAmountToMinorUnits,
  toExpenseMinorUnits,
} from './decimal.js';

export const PNB_PARSER_ID = 'pnb-ph-e-soa-v1';

const PNB_ANCHORS = [
  'statement of account',
  'account details',
  'trans date',
  'post date',
  'reference number',
  'description',
  'amount',
];

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseCalendarDate(month: number, day: number, year: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('invalid PNB statement date');
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findStatementDateText(document: ExtractedDocument): string {
  const joined = document.lines.map((line) => line.text).join('\n');
  const label = /statement\s+date/i.exec(joined);
  if (!label) throw new Error('missing_statement_context');

  // OCR commonly emits the PNB table headers on one line and their values on
  // the next line. Take the first calendar date after the statement-date
  // label; in PNB's header table that is the statement date, before the due date.
  const afterLabel = joined.slice(label.index + label[0].length);
  const date = afterLabel.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (date) return `${date[1]} ${date[2]} ${date[3]}`;

  const numeric = afterLabel.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (numeric) return `${numeric[1]}/${numeric[2]}/${numeric[3]}`;
  throw new Error('missing_statement_context');
}

export function resolvePnbParserContext(
  document: ExtractedDocument,
): ParserContext {
  const raw = findStatementDateText(document);
  const written = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (written) {
    const month = MONTHS[written[1].toLowerCase()];
    if (!month) throw new Error('invalid_statement_context');
    const year = Number(written[3]);
    const date = parseCalendarDate(month, Number(written[2]), year);
    return {
      statementId: `PNB_${date.replaceAll('-', '')}`,
      statementYear: year,
      currency: 'PHP',
    };
  }
  const numeric = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!numeric) throw new Error('invalid_statement_context');
  const month = Number(numeric[1]);
  const day = Number(numeric[2]);
  const year = Number(numeric[3]);
  const date = parseCalendarDate(month, day, year);
  return {
    statementId: `PNB_${date.replaceAll('-', '')}`,
    statementYear: year,
    currency: 'PHP',
  };
}

function parsePnbTransactionDate(raw: string, year: number): string {
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!match) throw new Error('invalid PNB transaction date');
  return parseCalendarDate(Number(match[2]), Number(match[1]), year);
}

function classifyExcluded(
  description: string,
  amountMinor: number,
): ExcludedSourceRow['exclusionReason'] | null {
  const text = normalize(description);
  if (text.includes('previous balance')) return 'previous-balance';
  if (text.includes('payment') || text.includes('credit'))
    return 'credit-card-payment';
  if (amountMinor < 0) return 'other';
  return null;
}

function parsePnbRow(text: string): {
  transDate: string;
  postDate: string;
  reference: string;
  description: string;
  amount: string;
} | null {
  const normalizedText = text.replace(/\s*([/-])\s*/g, '$1');
  const match = normalizedText.match(
    /^\s*(\d{1,2}[/-]\d{1,2})\s+(\d{1,2}[/-]\d{1,2})\s+([\d ]{8,47})\s+(.+?)\s+(-?P?\s*[\d,]+\.\d{2})(?:\s*CR)?\s*$/i,
  );
  if (!match) return null;
  return {
    transDate: match[1],
    postDate: match[2],
    reference: match[3].replace(/\s+/g, ''),
    description: match[4].trim().replace(/\s+/g, ' '),
    amount: match[5].replace(/^P\s*/i, ''),
  };
}

function parsePnbRowFromLines(
  lines: { page: number; text: string }[],
  index: number,
): { row: ReturnType<typeof parsePnbRow>; consumed: number; rawText: string } {
  const direct = parsePnbRow(lines[index].text);
  if (direct) {
    return { row: direct, consumed: 1, rawText: lines[index].text };
  }

  // OCR table segmentation may emit one transaction as several adjacent
  // lines (date, reference, description, amount). Reassemble only within
  // the same page and cap the look-ahead to avoid crossing unrelated rows.
  for (let width = 2; width <= 8; width++) {
    const chunk = lines.slice(index, index + width);
    if (chunk.length !== width || chunk.some((line) => line.page !== lines[index].page))
      break;
    const rawText = chunk.map((line) => line.text).join(' ');
    const row = parsePnbRow(rawText);
    if (row) return { row, consumed: width, rawText };
  }
  return { row: null, consumed: 1, rawText: lines[index].text };
}

export class PnbPhEsoaParser implements BankParser {
  readonly id = PNB_PARSER_ID;

  canParse(document: ExtractedDocument): ParserMatch {
    if (document.sourceFormat !== 'ocr') {
      return {
        matched: false,
        score: 0,
        reason: 'PNB parser only supports OCR format',
      };
    }
    const joined = normalize(document.lines.map((line) => line.text).join(' '));
    const hits = PNB_ANCHORS.filter((anchor) => joined.includes(anchor)).length;
    const rowCount = document.lines.filter((line) =>
      parsePnbRow(line.text),
    ).length;
    const hasCoreTable =
      joined.includes('account details') &&
      joined.includes('trans') &&
      joined.includes('post') &&
      joined.includes('reference') &&
      joined.includes('number') &&
      joined.includes('description') &&
      joined.includes('amount');
    const hasTransactionEvidence =
      rowCount > 0 ||
      /\b\d{1,2}[/-]\d{1,2}\b[\s\S]{0,100}\b\d{8,24}\b[\s\S]{0,200}\d[\d,]*\.\d{2}\b/.test(
        joined,
      );
    if (!hasCoreTable || hits < 4 || !hasTransactionEvidence) {
      return {
        matched: false,
        score: Math.min(0.5, hits / PNB_ANCHORS.length),
        reason: 'PNB account-details table not found',
        parserId: this.id,
      };
    }
    return {
      matched: true,
      score: 0.98,
      reason: `PNB account-details table and ${rowCount} transaction rows found`,
      parserId: this.id,
    };
  }

  parse(document: ExtractedDocument, context: ParserContext): ParsedStatement {
    const transactions: ExtractedTransaction[] = [];
    const excludedRows: ExcludedSourceRow[] = [];
    const issues: Issue[] = [];
    let recognizedCandidateCount = 0;
    let includedCounter = 0;
    let excludedCounter = 0;
    const seenRows = new Set<string>();

    const sortedLines = [...document.lines].sort((a, b) => a.order - b.order);
    for (let index = 0; index < sortedLines.length; index++) {
      const line = sortedLines[index];
      const candidate = parsePnbRowFromLines(sortedLines, index);
      const row = candidate.row;
      if (!row) continue;
      index += candidate.consumed - 1;
      const rowKey = `${row.transDate}|${row.postDate}|${row.reference}|${row.amount}`;
      if (seenRows.has(rowKey)) continue;
      seenRows.add(rowKey);
      recognizedCandidateCount++;
      let transDate: string;
      let amountMinor: number;
      try {
        transDate = parsePnbTransactionDate(
          row.transDate,
          context.statementYear,
        );
        amountMinor = parsePhpAmountToMinorUnits(row.amount);
      } catch {
        issues.push({
          code: 'malformed_row',
          severity: 'error',
          message: 'A PNB transaction row could not be parsed safely.',
          relatedSourceRowIds: [],
        });
        continue;
      }

      const exclusion = classifyExcluded(row.description, amountMinor);
      if (exclusion) {
        excludedCounter++;
        excludedRows.push({
          sourceRowId: `p${line.page}-x${String(excludedCounter).padStart(3, '0')}`,
          page: line.page,
          rawText: candidate.rawText,
          exclusionReason: exclusion,
        });
        continue;
      }

      includedCounter++;
      const sourceRowId = `p${line.page}-r${String(includedCounter).padStart(3, '0')}`;
      transactions.push({
        sourceRowId,
        statementId: context.statementId,
        date: transDate,
        description: row.description,
        amount: minorUnitsToAmount(toExpenseMinorUnits(Math.abs(amountMinor))),
        currency: 'PHP',
        reference: row.reference,
        source: {
          format: document.sourceFormat,
          bankParserId: this.id,
          page: line.page,
          row: line.order,
          rawText: candidate.rawText,
        },
        extractionConfidence: 0.96,
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

export const pnbParser = new PnbPhEsoaParser();
