import type {
  ExtractedDocument,
  TextLine,
  ParserMatch,
  ParserContext,
  ParsedStatement,
  Issue,
  ExtractedTransaction,
  ExcludedSourceRow,
} from './contracts.js';
import {
  parsePhpAmountToMinorUnits,
  minorUnitsToAmount,
  toExpenseMinorUnits,
} from './decimal.js';

const PARSER_ID = 'bdo-visa-gold-ph-image-v1';

// Anchor detection: stable BDO layout markers (not merchant/account/date)
const BDO_ANCHORS = [
  'bdo', // bank name
  'visa gold',
  'sale date',
  'post date',
  'description',
  'amount',
];

function normalizeForDetection(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsAnchor(lines: TextLine[]): boolean {
  const joined = lines.map((l) => normalizeForDetection(l.text)).join(' ');
  // Require at least 2 anchors to avoid false positive
  let hits = 0;
  for (const anchor of BDO_ANCHORS) {
    if (joined.includes(anchor)) hits++;
  }
  return hits >= 2;
}

// --- Normalizers ---

export function parseBdoSaleDate(raw: string, statementYear: number): string {
  // Accept MM-DD or MM/DD or MM-DD with optional spaces, month/day numeric
  // Raw may be "07-29" or "07/29" etc. Need to produce YYYY-MM-DD using statementYear
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2}|\d{4}))?$/);
  if (!m) throw new Error(`invalid date: ${raw}`);
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (m[3]) {
    const suppliedYear = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (suppliedYear !== statementYear) throw new Error('date year mismatch');
  }
  if (month < 1 || month > 12 || day < 1 || day > 31)
    throw new Error(`impossible date: ${raw}`);
  // Validate real calendar date (e.g., Feb 30 invalid)
  const d = new Date(Date.UTC(statementYear, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day)
    throw new Error(`impossible date: ${raw}`);
  return `${statementYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parsePhpAmount(raw: string): number {
  // Accept documented thousands/decimal presentation; reject malformed
  // raw may have commas
  return parsePhpAmountToMinorUnits(raw);
}

export function normalizeDescription(raw: string): string {
  // Trim/collapse repeated whitespace, retain meaning and installment text
  return raw.trim().replace(/\s+/g, ' ');
}

export function normalizeReference(raw: string): string {
  // raw is like "Reference: 12345" or "Reference:ABC"
  const m = raw.match(/reference\s*:\s*(.+)/i);
  if (!m) throw new Error(`invalid reference: ${raw}`);
  const ref = m[1].trim().replace(/\s+/g, ' ');
  if (ref.length === 0) throw new Error('empty reference');
  if (ref.length > 200) throw new Error('reference too long');
  return ref;
}

export function classifyExcludedBdoRow(
  text: string,
): 'previous-balance' | 'credit-card-payment' | 'summary' | 'other' | null {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  // Normalize spaces and hyphens for comparison
  const compact = normalized.replace(/[-\s]+/g, ' ').trim();
  if (compact.includes('previous statement balance')) return 'previous-balance';
  if (compact.includes('payment received') && compact.includes('thank you'))
    return 'credit-card-payment';
  if (/^(?:subtotal|total)(?:\s+-?[\d,]+\.\d{2})?$/.test(compact))
    return 'summary';
  return null;
}

// --- BankParser interface ---
export interface BankParser {
  readonly id: string;
  canParse(document: ExtractedDocument): ParserMatch;
  parse(document: ExtractedDocument, context: ParserContext): ParsedStatement;
}

export class BdoVisaGoldPhImageParser implements BankParser {
  readonly id = PARSER_ID;

  canParse(document: ExtractedDocument): ParserMatch {
    if (document.sourceFormat !== 'ocr') {
      return {
        matched: false,
        score: 0,
        reason: 'BDO parser only supports OCR format',
      };
    }
    // Require at least ~10 structured rows or anchors
    if (document.lines.length < 5) {
      return {
        matched: false,
        score: 0.2,
        reason: 'too few lines for BDO layout',
      };
    }
    const hasAnchor = containsAnchor(document.lines);
    // Also check for date+amount pattern density
    const dateAmountLines = document.lines.filter((l) =>
      /(\d{1,2}[-/]\d{1,2}).*\d+\.\d{2}/.test(l.text),
    ).length;
    const score = hasAnchor
      ? Math.min(0.99, 0.5 + dateAmountLines * 0.02)
      : dateAmountLines >= 10
        ? 0.6
        : 0.3;
    const threshold = 0.55;
    if (score >= threshold) {
      return {
        matched: true,
        score,
        reason: `BDO anchors ${hasAnchor ? 'found' : 'weak'} + ${dateAmountLines} date/amount lines`,
        parserId: this.id,
      };
    }
    return {
      matched: false,
      score,
      reason: 'below threshold for BDO layout',
      parserId: this.id,
    };
  }

  parse(document: ExtractedDocument, context: ParserContext): ParsedStatement {
    const transactions: ExtractedTransaction[] = [];
    const excludedRows: ExcludedSourceRow[] = [];
    const issues: Issue[] = [];

    // State machine per spec
    // For deterministic IDs, we need page + order mapping.
    // Spec for fixture: p1-r001 etc by source order for supplied fixture.
    // For general: deterministic page + source-order ID scheme
    // We'll assign IDs as p{page}-r{globalOrder padded 3} for included, p{page}-x{idx padded 3} for excluded

    let pendingTx: ExtractedTransaction | null = null;
    let pendingRawText = '';

    // Track excluded counter per page? Use global excluded index but format as p{page}-x{counter}
    let excludedCounter = 0;
    let includedCounter = 0;
    let recognizedCandidateCount = 0;

    // To map to fixture exact IDs, we need to ensure order matches expected_extraction.csv source_order 1..37
    // We'll iterate lines in reading order (document.lines sorted by page then order)
    const sorted = [...document.lines].sort(
      (a, b) => a.page - b.page || a.order - b.order,
    );

    for (let idx = 0; idx < sorted.length; idx++) {
      const line = sorted[idx];
      const text = line.text.trim();
      if (text.length === 0) continue;

      // Check exclusions first (case/spacing-insensitive)
      const exclusion = classifyExcludedBdoRow(text);
      // However, exclusion rows may include amount, e.g., "PREVIOUS STATEMENT BALANCE 22,886.77"
      // So detection should look at prefix without amount
      // Our classifier already handles prefix
      // For payment received, it may be alone
      // Need to also detect exclusions when line contains exclusion phrase anywhere
      // We'll treat as excluded if classifier returns non-null
      if (exclusion) {
        recognizedCandidateCount++;
        excludedCounter++;
        const rawText = text;
        // Extract amount if present? Not needed for excluded
        const id = `p${line.page}-x${String(excludedCounter).padStart(3, '0')}`;
        // Map to expected: previous-balance, credit-card-payment, summary
        excludedRows.push({
          sourceRowId: id,
          page: line.page,
          rawText,
          exclusionReason: exclusion,
        });
        // If we had pending, it stays; exclusions are separate rows
        continue;
      }

      // Check for continuation lines
      const isInstalment = /instalment\s+\d+\s+of\s+\d+/i.test(text);
      const isReference = /^\s*reference\s*:/i.test(text);

      if (isInstalment || isReference) {
        if (!pendingTx) {
          issues.push({
            code: 'malformed_row',
            severity: 'warning',
            message: 'Orphan transaction continuation.',
            relatedSourceRowIds: [],
          });
          continue;
        }
        if (isInstalment) {
          const m = text.match(/instalment\s+(\d+)\s+of\s+(\d+)/i);
          if (m) {
            const installText = `INSTALMENT ${m[1]} OF ${m[2]}`;
            pendingTx.description = normalizeDescription(
              `${pendingTx.description} | ${installText}`,
            );
            pendingRawText = `${pendingRawText} | ${text}`;
            // update confidence to reflect ambiguity? Lower slightly
            pendingTx.extractionConfidence = Math.min(
              pendingTx.extractionConfidence,
              0.92,
            );
            pendingTx.source.rawText = pendingRawText;
          }
        } else if (isReference) {
          try {
            const ref = normalizeReference(text);
            pendingTx.reference = ref;
            pendingRawText = `${pendingRawText} | ${text}`;
            pendingTx.source.rawText = pendingRawText;
          } catch {
            issues.push({
              code: 'malformed_row',
              severity: 'warning',
              message: 'Invalid reference continuation.',
              relatedSourceRowIds: pendingTx ? [pendingTx.sourceRowId] : [],
            });
          }
        }
        continue;
      }

      // Try to recognize new transaction row containing sale date, description, amount
      // Pattern: date at start like 07-29 or 07/29, then description, then amount like 828.33 or 1,234.56
      // Amount may be at end
      const startsLikeTransaction =
        /^\s*\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/.test(text);
      const txMatch = text.match(
        /^\s*(\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?)(?:\s+\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?)?\s+(.+?)\s+(-?[\d,]+\.\d{2})\s*$/,
      );
      if (txMatch) {
        recognizedCandidateCount++;
        // Flush previous pending? Actually pendingTx is already in transactions list; we just start new
        const saleDateRaw = txMatch[1];
        const descriptionRaw = txMatch[2];
        const amountRaw = txMatch[3];

        // Validate and normalize
        let isoDate: string;
        try {
          isoDate = parseBdoSaleDate(saleDateRaw, context.statementYear);
        } catch {
          issues.push({
            code: 'missing_date',
            severity: 'error',
            message: `invalid sale date: ${saleDateRaw}`,
            relatedSourceRowIds: [],
          });
          continue;
        }
        let amountMinor: number;
        try {
          amountMinor = parsePhpAmount(amountRaw);
        } catch {
          issues.push({
            code: 'invalid_decimal',
            severity: 'error',
            message: `invalid amount: ${amountRaw}`,
            relatedSourceRowIds: [],
          });
          continue;
        }
        // Exclude payment as negative? But payment rows already classified as excluded
        // Charges are positive on statement, we store negative expense
        const expenseMinor = toExpenseMinorUnits(Math.abs(amountMinor));
        const amount = minorUnitsToAmount(expenseMinor);

        includedCounter++;
        const sourceRowId = `p${line.page}-r${String(includedCounter).padStart(3, '0')}`;
        // For fixture, included IDs should be p1-r001..p1-r015, p2-r016..p2-r032, p3-r033 etc.
        // Our counter matches expected if lines are in correct order and we skip exclusions correctly?
        // But fixture order: p1-x001 is excluded before p1-r001, so r001 corresponds to second source row.
        // Our includedCounter alone yields p1-r001 for first charge on page1, which matches expected.
        // Excluded rows use separate x counter, but expected excluded IDs are p1-x001, p2-x002, p3-x003, p3-x004
        // Our excludedCounter sequential 1..4 yields same but page prefix differs for second.
        // Second excluded should be p2-x002 not p1-x002 — our page-based id does that correctly.

        const normalizedDesc = normalizeDescription(descriptionRaw);
        if (normalizedDesc.length === 0) {
          issues.push({
            code: 'malformed_row',
            severity: 'error',
            message: 'empty description',
            relatedSourceRowIds: [sourceRowId],
          });
          continue;
        }

        pendingRawText = text;
        const tx: ExtractedTransaction = {
          sourceRowId,
          statementId: context.statementId,
          date: isoDate,
          description: normalizedDesc,
          amount,
          currency: 'PHP',
          source: {
            format: document.sourceFormat,
            bankParserId: this.id,
            page: line.page,
            row: line.order,
            rawText: pendingRawText,
          },
          extractionConfidence: 0.98,
          issues: [],
        };
        transactions.push(tx);
        pendingTx = tx;

        continue;
      }

      if (startsLikeTransaction) {
        recognizedCandidateCount++;
        issues.push({
          code: 'malformed_row',
          severity: 'error',
          message: 'A transaction-like source row could not be parsed safely.',
          relatedSourceRowIds: [],
        });
        pendingTx = null;
        continue;
      }

      // If line doesn't match any case, treat as potential header/footer or noise — ignore but log info if ambiguous
      // Check if it looks like header column labels
      if (
        /sale date/i.test(text) &&
        /description/i.test(text) &&
        /amount/i.test(text)
      ) {
        continue;
      }
      // If it looks like a bank header, continue
      if (
        /bdo/i.test(text) ||
        /statement/i.test(text) ||
        /account/i.test(text)
      ) {
        continue;
      }
      // Otherwise ambiguous token — could be OCR noise, add info issue but not transaction
      // For fixture, we expect all lines to be accounted; so ignore
    }

    // Post-loop: handle id mapping adjustment for fixture compatibility?
    // The expected fixture has specific mapping where excludedCounter global sequential but page-specific.
    // Our current excluded ids are p{page}-x{counter} where counter increments globally (1..4) but page changes.
    // Expected: p1-x001, p2-x002, p3-x003, p3-x004 -> matches our global counter: first excluded on page1 -> p1-x001, second on page2 -> p2-x002, third on page3 -> p3-x003, fourth on page3 -> p3-x004 correct.
    // Included ids: p1-r001..p1-r015 (15), p2-r016..p2-r032 (17), p3-r033 (1) -> our includedCounter 1..33 with page prefix derived from line.page will produce correct because first 15 lines page1, next 17 page2, last 1 page3.
    // However our page derivation for included is from line.page, so p2-r016 would correctly be page2 for 16th transaction. Good.

    // Attach issues to result, not per-row for malformed
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

export const bdoParser = new BdoVisaGoldPhImageParser();
