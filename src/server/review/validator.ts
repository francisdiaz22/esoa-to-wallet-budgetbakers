import { Issue, isBlocking } from '../shared/issues.js';
import type { ReviewItem, ReviewSummary } from './contracts.js';
import { LIMITS } from '../ingestion/limits.js';

export function isValidCategory(
  categoryName: string,
  allowed: Set<string>,
): boolean {
  return allowed.has(categoryName);
}

/**
 * Pure validation for a single review item.
 * Returns derived issues that should be present on the item (including duplicate warnings passed separately).
 * Does not mutate.
 */
export function validateReviewItem(
  item: ReviewItem,
  context: {
    allowedCategories: Set<string>;
    isSplitParent: boolean;
    splitChildren: ReviewItem[]; // if isSplitParent, the children for sum check
    sourceAmountMinor?: number; // original source amount for split total check
  },
): Issue[] {
  const issues: Issue[] = [];

  // Source transaction linkage and valid proposal already assumed by service; if proposal unknown/outcome not proposed etc, we flag category_required
  // But we derive issues based on reviewState and item fields

  // Valid source transaction and current proposal linkage — if proposal missing? Already part of item, but if proposal indicates unknown/malformed, need category
  // We cannot inspect proposal outcome here without extra; we add generic checks below

  // Category present and allowlisted before approval
  if (item.reviewState === 'approved') {
    if (!item.categoryName) {
      issues.push({
        code: 'category_required',
        severity: 'error',
        message: 'Category required for approval.',
        relatedSourceRowIds: [item.sourceRowId],
      });
    } else if (!context.allowedCategories.has(item.categoryName)) {
      issues.push({
        code: 'category_not_allowed',
        severity: 'error',
        message: `Category "${item.categoryName}" not in catalog.`,
        relatedSourceRowIds: [item.sourceRowId],
      });
    }
    // unknown never approvable — if categoryName is unknown explicitly? allowedCategories contains 'unknown' never; but UI prevents. Check if item.categoryName === 'unknown'
    if (item.categoryName === 'unknown') {
      issues.push({
        code: 'category_not_allowed',
        severity: 'error',
        message: 'unknown is not an approvable category.',
        relatedSourceRowIds: [item.sourceRowId],
      });
    }
    // Also if proposal outcome is unknown/low_confidence etc and category still not supplied? Already covered by category_required if missing
  }

  // For non-approved but with category, ensure allowlisted if present
  if (item.categoryName && !context.allowedCategories.has(item.categoryName)) {
    // if not already added for approved, add
    if (!issues.some((i) => i.code === 'category_not_allowed')) {
      issues.push({
        code: 'category_not_allowed',
        severity: 'error',
        message: `Category "${item.categoryName}" not in catalog.`,
        relatedSourceRowIds: [item.sourceRowId],
      });
    }
  }

  // unknown proposal outcome remain review-required until reviewer supplies category
  // If proposal outcome is unknown / low_confidence / provider_unavailable / provider_malformed and item still has no valid category, ensure needs_review state
  // We don't auto-flag issue here beyond category_required; but if item is approved with such proposal and no category, above already flagged

  // Exclusion reason is required only for excluded and must be removed when needs_review/approved
  if (item.reviewState === 'excluded') {
    if (!item.exclusionReason) {
      issues.push({
        code: 'split_invalid',
        severity: 'error',
        message: 'Exclusion requires a reason.',
        relatedSourceRowIds: [item.sourceRowId],
      });
    }
  } else {
    if (item.exclusionReason) {
      issues.push({
        code: 'split_invalid',
        severity: 'error',
        message: 'Exclusion reason must be removed when not excluded.',
        relatedSourceRowIds: [item.sourceRowId],
      });
    }
  }

  // Split children validation
  if (item.kind === 'split') {
    // split children have non-empty category before approval and signed total equals original amount exactly in centavos — checked at parent level
    if (item.reviewState === 'approved' && !item.categoryName) {
      if (!issues.some((i) => i.code === 'category_required')) {
        issues.push({
          code: 'category_required',
          severity: 'error',
          message: 'Split child requires category before approval.',
          relatedSourceRowIds: [item.sourceRowId],
        });
      }
    }
    // date/amount/description remain source-owned for unsplit records — for split children they may have independent category etc but amount is explicit; not validated here
  }

  // Split parent validation
  if (context.isSplitParent) {
    if (item.reviewState === 'approved' || item.reviewState === 'excluded') {
      issues.push({
        code: 'split_parent_locked',
        severity: 'error',
        message:
          'Split parent is a container and cannot be approved or excluded.',
        relatedSourceRowIds: [item.sourceRowId],
      });
    }
    // Validate that children's signed total equals source amount exactly
    if (context.sourceAmountMinor !== undefined) {
      const sum = context.splitChildren.reduce(
        (acc, c) => acc + c.amountMinor,
        0,
      );
      if (sum !== context.sourceAmountMinor) {
        issues.push({
          code: 'split_total_mismatch',
          severity: 'error',
          message: `Split total ${sum} does not equal source amount ${context.sourceAmountMinor}.`,
          relatedSourceRowIds: [item.sourceRowId],
        });
      }
    }
    // Also if any child missing category, that child has its own issue; parent also gets split_invalid if children invalid?
    // But spec says while unbalanced, no child can be approved — that is enforced by blocking check on each child referencing parent sum mismatch.
    // We add parent-level split_invalid if any child is invalid? Not needed.
  }

  // Blocking parser errors always prevent approval. The source transaction issues are already in item.proposal? Actually extraction issues are in source transaction; but proposal issues may include them.
  // For now, if item.proposal.issues contains error severity with blocking codes, we propagate
  for (const pi of item.proposal.issues) {
    if (pi.severity === 'error' && isBlocking(pi.code as never)) {
      // If this issue not already in our issues, add a derived review_not_approved? Or replicate
      // Spec says blocking parser errors always prevent approval — we enforce that if such issue exists, approval is blocked.
      // Add an issue to make blocking count visible if not already present
      if (!issues.some((i) => i.code === pi.code)) {
        issues.push({
          code: pi.code as never,
          severity: 'error',
          message: pi.message,
          relatedSourceRowIds: [item.sourceRowId],
        });
      }
    }
  }

  // Payee/note bounded - already schema, but double-check length
  if (item.payee && item.payee.length > LIMITS.MAX_REVIEW_PAYEE_LENGTH) {
    issues.push({
      code: 'split_invalid',
      severity: 'error',
      message: 'Payee exceeds length limit.',
      relatedSourceRowIds: [item.sourceRowId],
    });
  }
  if (item.note && item.note.length > LIMITS.MAX_REVIEW_NOTE_LENGTH) {
    issues.push({
      code: 'split_invalid',
      severity: 'error',
      message: 'Note exceeds length limit.',
      relatedSourceRowIds: [item.sourceRowId],
    });
  }

  // For unsplit source items, date/amount/description remain source-owned — we don't validate mutation here, but service prevents editing those.

  // Also ensure split child parent linkage correct — already schema

  // Deduplicate issues by code+message?
  return dedupIssues([
    ...item.issues.filter((i) => !isDerivedIssue(i.code)),
    ...issues,
  ]);
}

function isDerivedIssue(code: string): boolean {
  // Derived validation codes that we regenerate each time; filter old derived to avoid accumulation
  return [
    'duplicate_exact',
    'duplicate_near',
    'category_required',
    'category_not_allowed',
    'split_total_mismatch',
    'split_invalid',
    'split_parent_locked',
  ].includes(code);
}

function dedupIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of issues) {
    const key = `${i.code}|${i.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(i);
    }
  }
  return out;
}

export function isBlockingIssue(issue: Issue): boolean {
  return isBlocking(issue.code as never);
}

export function computeSummary(items: ReviewItem[]): ReviewSummary {
  const approved = items.filter((i) => i.reviewState === 'approved');
  const excluded = items.filter((i) => i.reviewState === 'excluded');
  const needs = items.filter((i) => i.reviewState === 'needs_review');
  // blockingCount: items that have any blocking issue
  let blockingCount = 0;
  let warningCount = 0;
  for (const it of items) {
    const hasBlocking = it.issues.some(isBlockingIssue);
    if (hasBlocking) blockingCount++;
    else if (it.issues.some((iss) => iss.severity === 'warning'))
      warningCount++;
  }
  // duplicateCandidateCount: items that have at least one duplicateMatch
  const duplicateCandidateCount = items.filter(
    (i) => i.duplicateMatches.length > 0,
  ).length;
  // splitSourceCount: number of distinct sourceRowIds that have been split (parents exist)
  // Identify source parents: kind source but has children concept? We track via items where kind source and duplicate? Instead, detect parents by checking if there are split children with same sourceRowId
  // Easiest: count distinct sourceRowIds where at least one item has kind split
  const sourcesWithSplits = new Set<string>();
  for (const it of items) {
    if (it.kind === 'split') sourcesWithSplits.add(it.sourceRowId);
  }
  const splitSourceCount = sourcesWithSplits.size;

  // sourceChargeCount: distinct sourceRowIds
  const sourceChargeCount = new Set(items.map((i) => i.sourceRowId)).size;

  // totalItems is leaf + parents? Spec says totalItems counts review items (?) Might be all items including parents? Let's count all items.
  const totalItems = items.length;

  // approvedExpenseTotalMinor: sum of approved leaf amounts (exclude parents which are containers, and excluded/needs_review not counted)
  // Only approved split children and approved unsplit source items count. Parents are never approved, so they contribute 0.
  const approvedExpenseTotalMinor = approved
    .filter((i) => i.kind !== 'source' || !sourcesWithSplits.has(i.sourceRowId)) // if source parent, it's not approved anyway
    .reduce((acc, i) => acc + i.amountMinor, 0);

  return {
    totalItems,
    sourceChargeCount,
    approvedCount: approved.length,
    excludedCount: excluded.length,
    needsReviewCount: needs.length,
    blockingCount,
    warningCount,
    duplicateCandidateCount,
    splitSourceCount,
    approvedExpenseTotalMinor,
  };
}
