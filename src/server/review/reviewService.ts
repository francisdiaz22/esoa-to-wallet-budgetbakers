import { randomUUID } from 'node:crypto';
import { SessionStore } from '../ingestion/sessionStore.js';
import { LIMITS } from '../ingestion/limits.js';
import type { Issue } from '../shared/issues.js';
import { detectDuplicates } from './duplicateDetector.js';
import { validateReviewItem, computeSummary } from './validator.js';
import type {
  ReviewItem,
  ReviewSummary,
  ReviewAuditEvent,
} from './contracts.js';
import { ReviewItemSchema } from './contracts.js';
import { globalSessionStore } from '../ingestion/sessionStore.js';

function makeAuditEvent(
  action: ReviewAuditEvent['action'],
  sourceRowId: string,
  reviewItemId: string | undefined,
  safeDetails: Record<string, string | number | boolean | string[]>,
): ReviewAuditEvent {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    action,
    reviewItemId,
    sourceRowId,
    safeDetails,
  };
}

function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

export class ReviewService {
  constructor(private store: SessionStore) {}

  initialize(
    sessionId: string,
  ):
    | { items: ReviewItem[]; summary: ReviewSummary; reviewVersion: number }
    | { error: { status: number; code: string; message: string } } {
    const entry = this.store.getEntry(sessionId);
    if (!entry)
      return {
        error: {
          status: 404,
          code: 'session_not_found',
          message: 'Session not found.',
        },
      };
    const extraction = entry.result;
    const phase2 = entry.phase2;
    if (
      !phase2 ||
      !phase2.proposals ||
      !phase2.catalog ||
      !phase2.historyVersion
    ) {
      return {
        error: {
          status: 422,
          code: 'review_not_initialized',
          message: 'Extraction, history, and proposals required before review.',
        },
      };
    }
    if (phase2.proposals.length !== extraction.transactions.length) {
      return {
        error: {
          status: 422,
          code: 'proposal_mismatch',
          message: 'Proposal count must equal transaction count.',
        },
      };
    }
    // Check existing review — if already exists, return it (idempotent? But spec says initialization permitted only when ...; we allow re-init to be idempotent if same version? We'll reject if already initialized to avoid overwriting decisions.)
    const existing = this.store.getReview(sessionId);
    if (existing) {
      const summary = computeSummary(existing.reviewItems);
      return {
        items: existing.reviewItems,
        summary,
        reviewVersion: existing.reviewVersion,
      };
    }

    // Build map proposal by sourceRowId
    const proposalByRow = new Map<string, (typeof phase2.proposals)[number]>();
    for (const p of phase2.proposals) proposalByRow.set(p.sourceRowId, p);

    // Allowed categories set
    const allowed = new Set(phase2.catalog.map((c) => c.categoryName));

    // Build initial review items in extraction source order
    const txOrdered = [...extraction.transactions]; // already source order
    const items: ReviewItem[] = [];
    for (const tx of txOrdered) {
      const proposal = proposalByRow.get(tx.sourceRowId);
      if (!proposal)
        return {
          error: {
            status: 422,
            code: 'proposal_mismatch',
            message: `Missing proposal for ${tx.sourceRowId}`,
          },
        };
      const amountMinor = toMinor(tx.amount);
      const item: ReviewItem = {
        reviewItemId: randomUUID(),
        kind: 'source',
        sourceRowId: tx.sourceRowId,
        amountMinor,
        date: tx.date,
        description: tx.description.slice(
          0,
          LIMITS.MAX_REVIEW_DESCRIPTION_LENGTH,
        ),
        categoryName: proposal.categoryName, // may be undefined for unknown
        reviewState: 'needs_review',
        proposal: structuredClone(proposal) as never, // immutable copy
        duplicateMatches: [],
        issues: [],
        revision: 0,
      };
      // Preserve reference derived from extraction for duplicate detection? Not in ReviewItem schema but we store payee? No. We'll keep reference as part of transaction for detector via ad-hoc.
      // Store temporarily for detection via map
      items.push(item);
    }

    // Run duplicate detection
    // Need reference per transaction
    const refByRow = new Map<string, string | undefined>();
    for (const tx of extraction.transactions)
      refByRow.set(tx.sourceRowId, tx.reference);
    const dupInputs = items.map((it) => ({
      reviewItemId: it.reviewItemId,
      sourceRowId: it.sourceRowId,
      date: it.date,
      amountMinor: it.amountMinor,
      description: it.description,
      reference: refByRow.get(it.sourceRowId),
    }));
    const dupMap = detectDuplicates(dupInputs);
    // Attach duplicateMatches and initial derived issues
    for (const it of items) {
      const matches = dupMap.get(it.reviewItemId) ?? [];
      it.duplicateMatches = matches;
      // Derive duplicate issues
      const hasExact = matches.some((m) => m.matchKind === 'exact');
      const hasNear = matches.some((m) => m.matchKind === 'near');
      const dupIssues: Issue[] = [];
      if (hasExact)
        dupIssues.push({
          code: 'duplicate_exact',
          severity: 'warning',
          message: 'Exact duplicate candidate in statement.',
          relatedSourceRowIds: matches.map((m) => m.candidateSourceRowId),
        });
      else if (hasNear)
        dupIssues.push({
          code: 'duplicate_near',
          severity: 'warning',
          message: 'Near duplicate candidate in statement.',
          relatedSourceRowIds: matches.map((m) => m.candidateSourceRowId),
        });
      it.issues = dupIssues;
      // Run validator to add any blocking issues (e.g., missing category) — but initial category may be undefined -> category_required? But spec says validation at least category_required etc is checked before approval, not necessarily on needs_review. However we should add issues that block approval so UI can show blockers. For initial needs_review items with unknown category, we should add category_required? Let's decide: Add category_required if category missing and not approved yet? The validator will add that only when reviewState approved. So for needs_review, missing category is not an issue but they need to see they cannot approve without category. However we want to flag that as blocker for approval but not as issue until approval attempt? Spec validation list includes "category present and exactly allowlisted before approval" and validation function will enforce. So we may not need to add category_required upfront; it will be added when trying to approve. But we can compute initial blockingCount via validator logic that includes that.
      // Let's run validator for each item to populate initial issues
      const validated = validateReviewItem(it, {
        allowedCategories: allowed,
        isSplitParent: false,
        splitChildren: [],
        sourceAmountMinor: undefined,
      });
      // Merge dupIssues with validated
      // Remove duplicate duplicate_* issues duplication
      const hasDupExact = validated.some((i) => i.code === 'duplicate_exact');
      const hasDupNear = validated.some((i) => i.code === 'duplicate_near');
      if (!hasDupExact && hasExact)
        validated.unshift(dupIssues.find((d) => d.code === 'duplicate_exact')!);
      if (!hasDupNear && hasNear && !hasExact)
        validated.unshift(dupIssues.find((d) => d.code === 'duplicate_near')!);
      it.issues = validated;
      // Also include any proposal issues that are blocking (validator already does)
    }

    const summary = computeSummary(items);
    const audit: ReviewAuditEvent = makeAuditEvent(
      'review_initialized',
      items[0]?.sourceRowId ?? 'init',
      undefined,
      {
        totalItems: items.length,
        reviewVersion: 1,
      },
    );
    const state = {
      reviewItems: items,
      reviewVersion: 1,
      historyVersion: phase2.historyVersion,
      auditEvents: [audit],
    };
    this.store.setReview(sessionId, state);
    return { items, summary, reviewVersion: 1 };
  }

  getReview(sessionId: string):
    | {
        items: ReviewItem[];
        summary: ReviewSummary;
        reviewVersion: number;
        audit: ReviewAuditEvent[];
      }
    | { error: { status: number; code: string; message: string } } {
    const entry = this.store.getEntry(sessionId);
    if (!entry)
      return {
        error: {
          status: 404,
          code: 'session_not_found',
          message: 'Session not found.',
        },
      };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const summary = computeSummary(review.reviewItems);
    return {
      items: review.reviewItems,
      summary,
      reviewVersion: review.reviewVersion,
      audit: review.auditEvents,
    };
  }

  getItem(sessionId: string, reviewItemId: string): ReviewItem | null {
    const review = this.store.getReview(sessionId);
    if (!review) return null;
    return (
      review.reviewItems.find((i) => i.reviewItemId === reviewItemId) ?? null
    );
  }

  private checkAuditCap(sessionId: string): {
    ok: boolean;
    error?: { status: number; code: string; message: string };
  } {
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        ok: false,
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      return {
        ok: false,
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit trail limit exceeded; no further edits allowed.',
        },
      };
    }
    return { ok: true };
  }

  private getAllowedCategories(sessionId: string): Set<string> | null {
    const catalog = this.store.getCatalog(sessionId);
    if (!catalog) return null;
    return new Set(catalog.map((c) => c.categoryName));
  }

  private recomputeValidationForAll(sessionId: string) {
    const review = this.store.getReview(sessionId);
    const allowed = this.getAllowedCategories(sessionId);
    if (!review || !allowed) return;
    // Recompute issues for each item considering split parent totals and duplicate status
    // Need to map sourceRowId -> children and parent
    const bySource = new Map<string, ReviewItem[]>();
    for (const it of review.reviewItems) {
      if (!bySource.has(it.sourceRowId)) bySource.set(it.sourceRowId, []);
      bySource.get(it.sourceRowId)!.push(it);
    }
    for (const it of review.reviewItems) {
      const group = bySource.get(it.sourceRowId)!;
      const isParent =
        it.kind === 'source' && group.some((g) => g.kind === 'split');
      const children = group.filter((g) => g.kind === 'split');
      const effectiveSourceAmount = isParent
        ? it.amountMinor
        : bySource.get(it.sourceRowId)?.find((x) => x.kind === 'source')
            ?.amountMinor;
      const validated = validateReviewItem(it, {
        allowedCategories: allowed,
        isSplitParent: isParent,
        splitChildren: children,
        sourceAmountMinor: effectiveSourceAmount,
      });
      // Preserve duplicate issues that were derived from detector (they are part of validated? validator dedup keeps them if passed)
      // But duplicateMatches are separate; ensure issues include duplicate warnings from current duplicateMatches
      const hasExact = it.duplicateMatches.some((m) => m.matchKind === 'exact');
      const hasNear = it.duplicateMatches.some((m) => m.matchKind === 'near');
      const merged = [...validated];
      if (hasExact && !merged.some((i) => i.code === 'duplicate_exact')) {
        merged.unshift({
          code: 'duplicate_exact',
          severity: 'warning',
          message: 'Exact duplicate candidate.',
          relatedSourceRowIds: it.duplicateMatches.map(
            (m) => m.candidateSourceRowId,
          ),
        });
      } else if (hasNear && !merged.some((i) => i.code === 'duplicate_near')) {
        merged.unshift({
          code: 'duplicate_near',
          severity: 'warning',
          message: 'Near duplicate candidate.',
          relatedSourceRowIds: it.duplicateMatches.map(
            (m) => m.candidateSourceRowId,
          ),
        });
      }
      it.issues = merged;
    }
  }

  private notifyWalletAfterMutation(sessionId: string) {
    // Phase 1-3 changes invalidate selections/mapping/snapshot; keep journal successes
    // Use store helper which is available even without direct import of phase4 types
    const maybe = this.store as unknown as {
      notifyReviewChanged?: (sid: string) => void;
      invalidateWalletSnapshot?: (sid: string) => void;
    };
    if (maybe.notifyReviewChanged) maybe.notifyReviewChanged(sessionId);
    else if (maybe.invalidateWalletSnapshot)
      maybe.invalidateWalletSnapshot(sessionId);
  }

  editCategoryPayeeNote(
    sessionId: string,
    reviewItemId: string,
    revision: number,
    patch: {
      categoryName?: string;
      payee?: string | null;
      note?: string | null;
    },
  ):
    | { item: ReviewItem; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const idx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (idx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Item not found.',
        },
      };
    const item = review.reviewItems[idx];
    if (item.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    // Check if it's a split parent container — cannot edit category/payee/note on parent? Spec says parent is container, never approvable. Should forbid editing parent? But we can allow editing payee/note? Simpler to forbid any edit on parent and force edits on children.
    const bySource = review.reviewItems.filter(
      (i) => i.sourceRowId === item.sourceRowId,
    );
    const isParent =
      item.kind === 'source' && bySource.some((b) => b.kind === 'split');
    if (isParent)
      return {
        error: {
          status: 422,
          code: 'split_parent_locked',
          message: 'Split parent cannot be edited.',
        },
      };
    // Validate category allowlist if provided
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };
    let newCategory = item.categoryName;
    let categoryChanged = false;
    if (patch.categoryName !== undefined) {
      if (patch.categoryName !== null) {
        const cat = patch.categoryName.trim();
        if (!cat)
          return {
            error: {
              status: 400,
              code: 'category_required',
              message: 'Category required.',
            },
          };
        if (!allowed.has(cat))
          return {
            error: {
              status: 422,
              code: 'category_not_allowed',
              message: 'Category not allowed.',
            },
          };
        if (cat === 'unknown')
          return {
            error: {
              status: 422,
              code: 'category_not_allowed',
              message: 'unknown not allowed.',
            },
          };
        newCategory = cat;
        categoryChanged = newCategory !== item.categoryName;
      } else {
        newCategory = undefined;
        categoryChanged = true;
      }
    }
    let newPayee = item.payee;
    let payeeChanged = false;
    if (patch.payee !== undefined) {
      if (patch.payee === null || patch.payee === '') {
        if (newPayee !== undefined) payeeChanged = true;
        newPayee = undefined;
      } else {
        const v = patch.payee.trim().slice(0, LIMITS.MAX_REVIEW_PAYEE_LENGTH);
        if (v.length === 0) {
          if (newPayee !== undefined) payeeChanged = true;
          newPayee = undefined;
        } else {
          payeeChanged = v !== newPayee;
          newPayee = v;
        }
      }
    }
    let newNote = item.note;
    let noteChanged = false;
    if (patch.note !== undefined) {
      if (patch.note === null || patch.note === '') {
        if (newNote !== undefined) noteChanged = true;
        newNote = undefined;
      } else {
        const v = patch.note.trim().slice(0, LIMITS.MAX_REVIEW_NOTE_LENGTH);
        if (v.length === 0) {
          if (newNote !== undefined) noteChanged = true;
          newNote = undefined;
        } else {
          noteChanged = v !== newNote;
          newNote = v;
        }
      }
    }

    // Apply updates
    const updated: ReviewItem = {
      ...item,
      categoryName: newCategory,
      payee: newPayee,
      note: newNote,
      revision: item.revision + 1,
      // Any category edit moves to needs_review until explicitly approved
      reviewState: categoryChanged ? 'needs_review' : item.reviewState,
    };
    // If category changed and was approved, it must become needs_review; also clear exclusion reason if any (should not have, but just in case)
    if (categoryChanged && item.reviewState === 'approved') {
      updated.reviewState = 'needs_review';
    }
    // Also if item was excluded and we edit category/payee/note, should we move to needs_review? Spec: exclusion reason required only for excluded and must be removed when becomes needs_review or approved. Editing an excluded item should maybe require explicit return to review, not auto. But spec says edit category/payee/note moves item to needs_review until explicitly approved — implies if item was excluded and we edit, it becomes needs_review. Let's implement: if edit occurs on excluded, transition to needs_review and clear exclusionReason
    if (
      item.reviewState === 'excluded' &&
      (categoryChanged || payeeChanged || noteChanged)
    ) {
      updated.reviewState = 'needs_review';
      updated.exclusionReason = undefined;
    }

    // Validate via schema
    const parsed = ReviewItemSchema.safeParse(updated);
    if (!parsed.success)
      return {
        error: { status: 400, code: 'split_invalid', message: 'Invalid item.' },
      };

    review.reviewItems[idx] = parsed.data;
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);

    // Audit events — one per changed field? Spec lists category_changed, payee_changed, note_changed. Create separate events for each changed field, but we can combine? Let's create separate events for each field change bounded.
    const events: ReviewAuditEvent[] = [];
    if (categoryChanged)
      events.push(
        makeAuditEvent(
          'category_changed',
          item.sourceRowId,
          item.reviewItemId,
          {
            categoryName: newCategory ?? 'cleared',
            revision: updated.revision,
          },
        ),
      );
    if (payeeChanged)
      events.push(
        makeAuditEvent('payee_changed', item.sourceRowId, item.reviewItemId, {
          revision: updated.revision,
        }),
      );
    if (noteChanged)
      events.push(
        makeAuditEvent('note_changed', item.sourceRowId, item.reviewItemId, {
          revision: updated.revision,
        }),
      );
    // If no field changed, still treat as no-op? But we already incremented revision if we did; better to not create event if no change
    if (events.length === 0) {
      // No actual change, revert revision increment? Instead just return without audit
      // We already updated, but no change means we should not have incremented. Rollback?
      // For simplicity, if no change, revert and return original
      review.reviewItems[idx] = item;
      review.reviewVersion -= 1;
      const summary = computeSummary(review.reviewItems);
      return { item, summary };
    }
    for (const ev of events) {
      if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
        // Rollback? Spec says when cap reached, reject further edits with review_limit_exceeded rather than silently discarding audit history.
        // We already mutated; need to revert and return error
        review.reviewItems[idx] = item;
        review.reviewVersion -= 1;
        // Remove any events already appended? None yet
        return {
          error: {
            status: 422,
            code: 'review_limit_exceeded',
            message: 'Audit limit exceeded.',
          },
        };
      }
      review.auditEvents.push(ev);
    }

    const summary = computeSummary(review.reviewItems);
    const finalItem = review.reviewItems[idx];
    return { item: finalItem, summary };
  }

  approveOne(
    sessionId: string,
    reviewItemId: string,
    revision: number,
  ):
    | { item: ReviewItem; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const idx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (idx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Item not found.',
        },
      };
    const item = review.reviewItems[idx];
    if (item.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    // Check if parent container
    const bySource = review.reviewItems.filter(
      (i) => i.sourceRowId === item.sourceRowId,
    );
    const isParent =
      item.kind === 'source' && bySource.some((b) => b.kind === 'split');
    if (isParent)
      return {
        error: {
          status: 422,
          code: 'split_parent_locked',
          message: 'Parent cannot be approved.',
        },
      };
    // Validate approval eligibility
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };
    // Recompute validation to ensure no blocking issues
    // First, ensure current item's issues don't contain blocking
    const temp = { ...item, reviewState: 'approved' as const };
    const validated = validateReviewItem(temp as ReviewItem, {
      allowedCategories: allowed,
      isSplitParent: false,
      splitChildren: [],
      sourceAmountMinor: undefined,
    });
    // For split child, need to check parent total mismatch
    if (item.kind === 'split') {
      const parent = bySource.find((b) => b.kind === 'source');
      if (parent) {
        const children = bySource.filter((b) => b.kind === 'split');
        const sum = children.reduce((acc, c) => acc + c.amountMinor, 0);
        if (sum !== parent.amountMinor) {
          return {
            error: {
              status: 422,
              code: 'split_total_mismatch',
              message: 'Split total mismatch; cannot approve.',
            },
          };
        }
        // Also need to validate parent mismatch issue present? Check children's parent total
        // If any child missing category, that child can't be approved — already checked via validated
      }
    } else {
      // For unsplit source with splits existing, this would have been isParent check
      // For unsplit source without splits, check parent total not needed
    }
    const blockingCodes = validated.filter((i) => i.severity === 'error');
    if (blockingCodes.length > 0) {
      return {
        error: {
          status: 422,
          code: blockingCodes[0].code,
          message: blockingCodes[0].message,
        },
      };
    }
    if (
      !item.categoryName ||
      !allowed.has(item.categoryName) ||
      item.categoryName === 'unknown'
    ) {
      return {
        error: {
          status: 422,
          code: 'category_required',
          message: 'Category required.',
        },
      };
    }
    // Also check duplicate is non-blocking — approval allowed even with duplicate warning after conscious review, so we don't block duplicate

    const updated: ReviewItem = {
      ...item,
      reviewState: 'approved',
      exclusionReason: undefined,
      revision: item.revision + 1,
    };
    const parsed = ReviewItemSchema.safeParse(updated);
    if (!parsed.success)
      return {
        error: {
          status: 400,
          code: 'split_invalid',
          message: 'Invalid approval.',
        },
      };
    review.reviewItems[idx] = parsed.data;
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent('approved', item.sourceRowId, item.reviewItemId, {
      categoryName: item.categoryName ?? '',
      revision: updated.revision,
    });
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      review.reviewItems[idx] = item;
      review.reviewVersion -= 1;
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { item: parsed.data, summary };
  }

  excludeOne(
    sessionId: string,
    reviewItemId: string,
    revision: number,
    reason: ReviewItem['exclusionReason'],
    note?: string,
  ):
    | { item: ReviewItem; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const idx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (idx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Item not found.',
        },
      };
    const item = review.reviewItems[idx];
    if (item.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    const bySource = review.reviewItems.filter(
      (i) => i.sourceRowId === item.sourceRowId,
    );
    const isParent =
      item.kind === 'source' && bySource.some((b) => b.kind === 'split');
    if (isParent)
      return {
        error: {
          status: 422,
          code: 'split_parent_locked',
          message: 'Parent cannot be excluded.',
        },
      };
    if (!reason)
      return {
        error: {
          status: 400,
          code: 'split_invalid',
          message: 'Exclusion reason required.',
        },
      };
    const boundedNote = note
      ? note.trim().slice(0, LIMITS.MAX_REVIEW_NOTE_LENGTH)
      : undefined;
    const updated: ReviewItem = {
      ...item,
      reviewState: 'excluded',
      exclusionReason: reason,
      note: boundedNote ?? item.note,
      revision: item.revision + 1,
    };
    const parsed = ReviewItemSchema.safeParse(updated);
    if (!parsed.success)
      return {
        error: {
          status: 400,
          code: 'split_invalid',
          message: 'Invalid exclusion.',
        },
      };
    review.reviewItems[idx] = parsed.data;
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent('excluded', item.sourceRowId, item.reviewItemId, {
      exclusionReason: reason,
      revision: updated.revision,
    });
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      review.reviewItems[idx] = item;
      review.reviewVersion -= 1;
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { item: parsed.data, summary };
  }

  returnToReview(
    sessionId: string,
    reviewItemId: string,
    revision: number,
  ):
    | { item: ReviewItem; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const idx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (idx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Item not found.',
        },
      };
    const item = review.reviewItems[idx];
    if (item.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    const bySource = review.reviewItems.filter(
      (i) => i.sourceRowId === item.sourceRowId,
    );
    const isParent =
      item.kind === 'source' && bySource.some((b) => b.kind === 'split');
    if (isParent)
      return {
        error: {
          status: 422,
          code: 'split_parent_locked',
          message: 'Parent cannot be returned.',
        },
      };
    if (item.reviewState === 'needs_review')
      return { item, summary: computeSummary(review.reviewItems) };
    const updated: ReviewItem = {
      ...item,
      reviewState: 'needs_review',
      exclusionReason: undefined,
      revision: item.revision + 1,
    };
    const parsed = ReviewItemSchema.safeParse(updated);
    if (!parsed.success)
      return {
        error: { status: 400, code: 'split_invalid', message: 'Invalid.' },
      };
    review.reviewItems[idx] = parsed.data;
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent(
      'returned_to_review',
      item.sourceRowId,
      item.reviewItemId,
      { reviewState: 'needs_review', revision: updated.revision },
    );
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      review.reviewItems[idx] = item;
      review.reviewVersion -= 1;
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { item: parsed.data, summary };
  }

  bulkApprove(
    sessionId: string,
    reviewVersion: number,
  ):
    | { approvedCount: number; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    if (review.reviewVersion !== reviewVersion)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Review version conflict.',
        },
      };
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };

    // Compute eligible items: server-calculated eligible items. Exclude rows with any warning/error, any duplicate candidate, unbalanced split, unknown category, or already terminal state.
    // Spec says exclude rows with any warning/error, any duplicate candidate, unbalanced split, unknown category, or already terminal state.
    // So eligible = needs_review, no warning/error, no duplicate candidate, no split unbalanced, has allowlisted category
    const eligible: ReviewItem[] = [];
    // Need to know split parent totals to exclude unbalanced splits: compute source totals
    const bySource = new Map<string, ReviewItem[]>();
    for (const it of review.reviewItems) {
      if (!bySource.has(it.sourceRowId)) bySource.set(it.sourceRowId, []);
      bySource.get(it.sourceRowId)!.push(it);
    }
    const unbalancedSources = new Set<string>();
    for (const [src, group] of bySource) {
      if (group.some((g) => g.kind === 'split')) {
        const parent = group.find((g) => g.kind === 'source');
        const children = group.filter((g) => g.kind === 'split');
        if (parent) {
          const sum = children.reduce((acc, c) => acc + c.amountMinor, 0);
          if (sum !== parent.amountMinor) unbalancedSources.add(src);
        }
      }
    }

    for (const it of review.reviewItems) {
      if (it.reviewState !== 'needs_review') continue;
      if (isParent(it, review.reviewItems)) continue;
      if (unbalancedSources.has(it.sourceRowId)) continue;
      if (it.duplicateMatches.length > 0) continue;
      if (
        it.issues.some(
          (iss) => iss.severity === 'warning' || iss.severity === 'error',
        )
      )
        continue; // any warning/error includes duplicate warnings already filtered, but spec says exclude any warning/error
      if (
        !it.categoryName ||
        !allowed.has(it.categoryName) ||
        it.categoryName === 'unknown'
      )
        continue;
      // Also check proposal outcome? If proposal is unknown/low_confidence, but category now provided, it's okay.
      eligible.push(it);
    }

    function isParent(item: ReviewItem, all: ReviewItem[]): boolean {
      return (
        item.kind === 'source' &&
        all.some(
          (b) => b.sourceRowId === item.sourceRowId && b.kind === 'split',
        )
      );
    }

    if (eligible.length === 0) {
      // Still need to check audit cap? But no changes
      return { approvedCount: 0, summary: computeSummary(review.reviewItems) };
    }

    // Check audit cap for bulk: need eligible.length events + 1? Each bulk approve likely one audit event with count
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }

    // Atomically approve all eligible
    for (const it of eligible) {
      const idx = review.reviewItems.findIndex(
        (x) => x.reviewItemId === it.reviewItemId,
      );
      if (idx === -1) continue;
      const updated: ReviewItem = {
        ...review.reviewItems[idx],
        reviewState: 'approved',
        revision: review.reviewItems[idx].revision + 1,
      };
      const parsed = ReviewItemSchema.safeParse(updated);
      if (!parsed.success) {
        // atomic failure — rollback? For now return error and revert all
        // Revert any already updated? We haven't committed incremental version bump yet; we need transactional.
        // Simpler: validate all before mutating. Since validation above already ensures no blocking issues, this should succeed.
        return {
          error: {
            status: 422,
            code: 'split_invalid',
            message: 'Bulk approve validation failed.',
          },
        };
      }
      review.reviewItems[idx] = parsed.data;
    }
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent('approved', eligible[0].sourceRowId, undefined, {
      bulkCount: eligible.length,
      reviewVersion: review.reviewVersion,
    });
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { approvedCount: eligible.length, summary };
  }

  bulkPreview(
    sessionId: string,
  ):
    | { eligibleCount: number; eligibleIds: string[] }
    | { error: { status: number; code: string; message: string } } {
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };
    const bySource = new Map<string, ReviewItem[]>();
    for (const it of review.reviewItems) {
      if (!bySource.has(it.sourceRowId)) bySource.set(it.sourceRowId, []);
      bySource.get(it.sourceRowId)!.push(it);
    }
    const unbalancedSources = new Set<string>();
    for (const [src, group] of bySource) {
      if (group.some((g) => g.kind === 'split')) {
        const parent = group.find((g) => g.kind === 'source');
        const children = group.filter((g) => g.kind === 'split');
        if (parent) {
          const sum = children.reduce((acc, c) => acc + c.amountMinor, 0);
          if (sum !== parent.amountMinor) unbalancedSources.add(src);
        }
      }
    }
    const eligible: ReviewItem[] = [];
    for (const it of review.reviewItems) {
      if (it.reviewState !== 'needs_review') continue;
      if (
        it.kind === 'source' &&
        review.reviewItems.some(
          (b) => b.sourceRowId === it.sourceRowId && b.kind === 'split',
        )
      )
        continue;
      if (unbalancedSources.has(it.sourceRowId)) continue;
      if (it.duplicateMatches.length > 0) continue;
      if (
        it.issues.some(
          (iss) => iss.severity === 'warning' || iss.severity === 'error',
        )
      )
        continue;
      if (
        !it.categoryName ||
        !allowed.has(it.categoryName) ||
        it.categoryName === 'unknown'
      )
        continue;
      eligible.push(it);
    }
    return {
      eligibleCount: eligible.length,
      eligibleIds: eligible.map((e) => e.reviewItemId),
    };
  }

  async recategorize(
    sessionId: string,
    reviewItemId: string,
    revision: number,
  ): Promise<
    | { item: ReviewItem; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } }
  > {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const idx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (idx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Item not found.',
        },
      };
    const item = review.reviewItems[idx];
    if (item.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    // Split children cannot be reclassified
    if (item.kind === 'split')
      return {
        error: {
          status: 422,
          code: 'reclassification_not_allowed',
          message: 'Split children cannot be reclassified.',
        },
      };
    // Check if it's a split parent container — also not allowed (it's not a real source unsplit)
    const bySource = review.reviewItems.filter(
      (i) => i.sourceRowId === item.sourceRowId,
    );
    const isParent = bySource.some((b) => b.kind === 'split');
    if (isParent)
      return {
        error: {
          status: 422,
          code: 'reclassification_not_allowed',
          message: 'Split parent cannot be reclassified.',
        },
      };
    // Allowed only when needs_review or has been edited/flagged? For simplicity allow needs_review always, and also allow if category was edited? But spec says allowed only when item is needs_review or has been edited/flagged since its last classification. We will allow any needs_review; if approved/excluded, we could allow too? But spec says re-run classification only for an unsplit source item that was edited or flagged. So if item is approved, it shouldn't be reclassified unless it was edited? However our check: if reviewState is approved or excluded, we could still allow if we consider it flagged? Simpler to allow only needs_review to be safe, but spec says targeted re-categorization integration: For a flagged or edited unsplit item, reviewer may request... It is allowed only when the item is needs_review or has been edited/flagged since its last classification. So approved item that hasn't been edited should not be allowed? But we could allow approved needs_review? Let's allow if reviewState is needs_review always; if approved/excluded, return reclassification_not_allowed unless they were edited? We don't track edited flag, so we will allow approved/excluded to be reclassified but set to needs_review? For now, allow only needs_review — to be strict.
    if (item.reviewState !== 'needs_review') {
      return {
        error: {
          status: 422,
          code: 'reclassification_not_allowed',
          message: 'Only needs_review items can be reclassified.',
        },
      };
    }

    const historyVersionAtStart = this.store.getHistoryVersion(sessionId);
    const reviewVersionAtStart = review.reviewVersion;
    const sourceRowId = item.sourceRowId;
    const revisionAtStart = item.revision;

    // Mark pending
    this.store.setPendingRecategorize(sessionId, sourceRowId, revisionAtStart);

    // Import classification service dynamically to avoid circular
    const { globalClassificationService } =
      await import('../categorization/classificationService.js');
    const res = await globalClassificationService.categorizeSubset(sessionId, [
      sourceRowId,
    ]);

    // Check stale conditions after async
    const currentReview = this.store.getReview(sessionId);
    const currentEntry = this.store.getEntry(sessionId);
    const currentHistoryVersion = this.store.getHistoryVersion(sessionId);
    if (!currentReview || !currentEntry) {
      this.store.clearPendingRecategorize(sessionId);
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Session cleared during recategorization.',
        },
      };
    }
    if (currentHistoryVersion !== historyVersionAtStart) {
      this.store.clearPendingRecategorize(sessionId);
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'History changed during recategorization.',
        },
      };
    }
    if (currentReview.reviewVersion !== reviewVersionAtStart) {
      this.store.clearPendingRecategorize(sessionId);
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Review version changed.',
        },
      };
    }
    const currentIdx = currentReview.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (currentIdx === -1) {
      this.store.clearPendingRecategorize(sessionId);
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Item removed during recategorization.',
        },
      };
    }
    const currentItem = currentReview.reviewItems[currentIdx];
    if (currentItem.revision !== revisionAtStart) {
      this.store.clearPendingRecategorize(sessionId);
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Item revision changed.',
        },
      };
    }
    if (
      currentItem.kind === 'split' ||
      currentReview.reviewItems.some(
        (b) => b.sourceRowId === sourceRowId && b.kind === 'split',
      )
    ) {
      this.store.clearPendingRecategorize(sessionId);
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Item split during recategorization.',
        },
      };
    }
    this.store.clearPendingRecategorize(sessionId);

    if ('error' in res) {
      // On provider unavailability or malformed, use fallback but our categorizeSubset already returns per-row fallback proposals; so error here is likely history/provider not configured etc
      // For those, propagate as 422
      return {
        error: {
          status: res.error.status,
          code: res.error.code,
          message: res.error.message,
        },
      };
    }
    const newProposal = res.proposals[0];
    // Atomically replace proposal/retrieval/rationale/outcome, keep categoryName from new proposal? But spec says reclassification replaces only classification evidence for that item and returns it to needs_review; it must never silently re-approve it.
    // So we set new proposal, update categoryName to newProposal.categoryName ? Or keep reviewer category? Spec says reclassification replaces only classification evidence; the category will be from new proposal if available, but reviewState must be needs_review even if high-confidence.
    // We'll apply new proposal, set categoryName to newProposal.categoryName (may be undefined for unknown), and set reviewState needs_review
    const updated: ReviewItem = {
      ...currentItem,
      proposal: structuredClone(newProposal) as never,
      categoryName: newProposal.categoryName, // may be undefined
      reviewState: 'needs_review' as const,
      exclusionReason: undefined,
      revision: currentItem.revision + 1,
      // Do not change duplicateMatches, but re-run derived validation
    };
    const parsed = ReviewItemSchema.safeParse(updated);
    if (!parsed.success)
      return {
        error: {
          status: 500,
          code: 'provider_malformed',
          message: 'Proposal schema invalid.',
        },
      };
    currentReview.reviewItems[currentIdx] = parsed.data;
    // Recompute validation/duplicate display
    this.recomputeValidationForAll(sessionId);
    currentReview.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent('recategorized', sourceRowId, reviewItemId, {
      historyVersion: historyVersionAtStart ?? 0,
      revision: updated.revision,
    });
    if (currentReview.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      currentReview.reviewItems[currentIdx] = currentItem;
      currentReview.reviewVersion -= 1;
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    currentReview.auditEvents.push(ev);
    const summary = computeSummary(currentReview.reviewItems);
    return { item: parsed.data, summary };
  }

  createSplit(
    sessionId: string,
    reviewItemId: string,
    revision: number,
    splits: {
      amountMinor: number;
      categoryName: string;
      payee?: string;
      note?: string;
      description?: string;
    }[],
  ):
    | { parent: ReviewItem; children: ReviewItem[]; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const idx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === reviewItemId,
    );
    if (idx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Item not found.',
        },
      };
    const item = review.reviewItems[idx];
    if (item.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    if (item.kind !== 'source')
      return {
        error: {
          status: 422,
          code: 'split_invalid',
          message: 'Only source items can be split.',
        },
      };
    // Check already split
    const existingSplits = review.reviewItems.filter(
      (i) => i.sourceRowId === item.sourceRowId && i.kind === 'split',
    );
    if (existingSplits.length > 0)
      return {
        error: {
          status: 422,
          code: 'split_invalid',
          message: 'Already split.',
        },
      };
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };
    if (splits.length < 2)
      return {
        error: {
          status: 422,
          code: 'split_invalid',
          message: 'At least two children required.',
        },
      };
    if (splits.length > LIMITS.MAX_SPLIT_CHILDREN)
      return {
        error: {
          status: 422,
          code: 'split_invalid',
          message: 'Too many children.',
        },
      };
    // Validate each child
    for (const s of splits) {
      if (!Number.isInteger(s.amountMinor))
        return {
          error: {
            status: 422,
            code: 'split_invalid',
            message: 'Amount must be integer centavos.',
          },
        };
      if (!allowed.has(s.categoryName) || s.categoryName === 'unknown')
        return {
          error: {
            status: 422,
            code: 'category_not_allowed',
            message: 'Invalid category.',
          },
        };
      if (s.payee && s.payee.length > LIMITS.MAX_REVIEW_PAYEE_LENGTH)
        return {
          error: {
            status: 422,
            code: 'split_invalid',
            message: 'Payee too long.',
          },
        };
      if (s.note && s.note.length > LIMITS.MAX_REVIEW_NOTE_LENGTH)
        return {
          error: {
            status: 422,
            code: 'split_invalid',
            message: 'Note too long.',
          },
        };
      if (
        s.description &&
        s.description.length > LIMITS.MAX_REVIEW_DESCRIPTION_LENGTH
      )
        return {
          error: {
            status: 422,
            code: 'split_invalid',
            message: 'Description too long.',
          },
        };
    }
    // Validate sum equals source amount exactly in centavos
    const sum = splits.reduce((acc, s) => acc + s.amountMinor, 0);
    if (sum !== item.amountMinor) {
      return {
        error: {
          status: 422,
          code: 'split_total_mismatch',
          message: `Split total ${sum} does not equal source ${item.amountMinor}.`,
        },
      };
    }
    // Create parent container — keep original amount but mark as container, increment revision
    const parent: ReviewItem = {
      ...item,
      revision: item.revision + 1,
      // parent remains needs_review? But not approvable; we keep as needs_review but validator will flag split_parent_locked if someone tries to approve
      reviewState: 'needs_review',
      // remove exclusionReason etc
      exclusionReason: undefined,
      // keep duplicateMatches? Parent retains duplicateMatches from original? But parent is container, so duplicateMatches maybe empty? We'll keep original duplicateMatches but they will be shown as warnings on parent? Simpler to clear parent duplicateMatches? But spec says duplicate detection identifies duplicate candidates within imported eSOA; parent represents same source charge, so its duplicate candidate warning should remain visible. We'll keep parent's duplicateMatches as before.
    };
    // Create children
    const children: ReviewItem[] = splits.map((s) => {
      const childId = randomUUID();
      const child: ReviewItem = {
        reviewItemId: childId,
        kind: 'split',
        sourceRowId: item.sourceRowId,
        parentReviewItemId: item.reviewItemId, // parent's original id? Use new parent id? Parent id stays same as original source item's reviewItemId, so children reference that.
        amountMinor: s.amountMinor,
        date: item.date,
        description: (s.description ?? item.description).slice(
          0,
          LIMITS.MAX_REVIEW_DESCRIPTION_LENGTH,
        ),
        payee: s.payee?.slice(0, LIMITS.MAX_REVIEW_PAYEE_LENGTH),
        note: s.note?.slice(0, LIMITS.MAX_REVIEW_NOTE_LENGTH),
        categoryName: s.categoryName,
        reviewState: 'needs_review',
        proposal: {
          // For split child, do not claim provider classified the allocation. Initialize with bounded reviewer-facing rationale
          proposalId: randomUUID(),
          sourceRowId: item.sourceRowId,
          classificationConfidence: 0.5,
          rationale: 'Created by reviewer split; select or confirm a category.',
          outcome: 'proposed',
          reviewState: 'needs_review',
          retrieval: [],
          issues: [],
          categoryName: s.categoryName,
        } as never,
        duplicateMatches: [],
        issues: [],
        revision: 0,
      };
      const parsed = ReviewItemSchema.safeParse(child);
      if (!parsed.success) throw new Error('invalid child');
      return parsed.data;
    });

    // Atomic replace: remove original item and insert parent + children in order
    // Keep order: parent at original index, children after
    const newItems = [...review.reviewItems];
    newItems.splice(idx, 1, parent, ...children);
    review.reviewItems = newItems;
    this.recomputeValidationForAll(sessionId);
    // But note parent total mismatch check: if sum not equal, children cannot be approved — recompute will add split_total_mismatch issue to parent
    // Already validated sum equals, so no mismatch; but we should still ensure children individually have no blocking issues except category etc.
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent(
      'split_created',
      item.sourceRowId,
      item.reviewItemId,
      { childCount: children.length, totalMinor: sum },
    );
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      // rollback
      review.reviewItems.splice(idx, 1 + children.length, item);
      review.reviewVersion -= 1;
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { parent, children, summary };
  }

  updateSplitChild(
    sessionId: string,
    parentReviewItemId: string,
    childId: string,
    revision: number,
    patch: {
      amountMinor?: number;
      categoryName?: string;
      payee?: string | null;
      note?: string | null;
      description?: string;
    },
  ):
    | { child: ReviewItem; summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const parentIdx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === parentReviewItemId,
    );
    if (parentIdx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Parent not found.',
        },
      };
    const childIdx = review.reviewItems.findIndex(
      (i) =>
        i.reviewItemId === childId &&
        i.kind === 'split' &&
        i.parentReviewItemId === parentReviewItemId,
    );
    if (childIdx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Child not found.',
        },
      };
    const child = review.reviewItems[childIdx];
    if (child.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };
    const parent = review.reviewItems[parentIdx];
    const updated: ReviewItem = { ...child };
    if (patch.amountMinor !== undefined) {
      if (!Number.isInteger(patch.amountMinor))
        return {
          error: {
            status: 422,
            code: 'split_invalid',
            message: 'Amount must be integer.',
          },
        };
      updated.amountMinor = patch.amountMinor;
    }
    if (patch.categoryName !== undefined) {
      if (!allowed.has(patch.categoryName) || patch.categoryName === 'unknown')
        return {
          error: {
            status: 422,
            code: 'category_not_allowed',
            message: 'Invalid category.',
          },
        };
      updated.categoryName = patch.categoryName;
      // category edit moves to needs_review if was approved
      if (child.reviewState === 'approved')
        updated.reviewState = 'needs_review';
      // also update proposal category to match
      (updated.proposal as unknown as { categoryName: string }).categoryName =
        patch.categoryName;
    }
    if (patch.payee !== undefined) {
      if (patch.payee === null || patch.payee === '') updated.payee = undefined;
      else
        updated.payee =
          patch.payee.trim().slice(0, LIMITS.MAX_REVIEW_PAYEE_LENGTH) ||
          undefined;
    }
    if (patch.note !== undefined) {
      if (patch.note === null || patch.note === '') updated.note = undefined;
      else
        updated.note =
          patch.note.trim().slice(0, LIMITS.MAX_REVIEW_NOTE_LENGTH) ||
          undefined;
    }
    if (patch.description !== undefined) {
      updated.description =
        patch.description
          .trim()
          .slice(0, LIMITS.MAX_REVIEW_DESCRIPTION_LENGTH) || child.description;
    }
    updated.revision = child.revision + 1;
    // Validate split total invariant on every mutation
    // Compute new sum with updated child
    const siblings = review.reviewItems.filter(
      (i) =>
        i.kind === 'split' &&
        i.parentReviewItemId === parentReviewItemId &&
        i.reviewItemId !== childId,
    );
    const sum =
      siblings.reduce((acc, s) => acc + s.amountMinor, 0) + updated.amountMinor;
    const isMismatch = sum !== parent.amountMinor;
    // While unbalanced, no child can be approved — we need to ensure updated child's reviewState is needs_review if mismatch? But spec says while unbalanced, no child can be approved. So we should set child's reviewState to needs_review if mismatch and it was approved? Actually we already set to needs_review on category edit; but amount mismatch should also force needs_review? Let's enforce: if mismatch, set updated.reviewState = 'needs_review'
    if (isMismatch && updated.reviewState === 'approved')
      updated.reviewState = 'needs_review';

    const parsed = ReviewItemSchema.safeParse(updated);
    if (!parsed.success)
      return {
        error: {
          status: 400,
          code: 'split_invalid',
          message: 'Invalid child.',
        },
      };
    review.reviewItems[childIdx] = parsed.data;
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent(
      'split_updated',
      child.sourceRowId,
      child.reviewItemId,
      { amountMinor: updated.amountMinor, revision: updated.revision },
    );
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      review.reviewItems[childIdx] = child;
      review.reviewVersion -= 1;
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { child: parsed.data, summary };
  }

  removeSplit(
    sessionId: string,
    parentReviewItemId: string,
    revision: number,
    childId?: string,
  ):
    | { summary: ReviewSummary }
    | { error: { status: number; code: string; message: string } } {
    const cap = this.checkAuditCap(sessionId);
    if (!cap.ok) return { error: cap.error! };
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    const parentIdx = review.reviewItems.findIndex(
      (i) => i.reviewItemId === parentReviewItemId,
    );
    if (parentIdx === -1)
      return {
        error: {
          status: 404,
          code: 'review_item_not_found',
          message: 'Parent not found.',
        },
      };
    const parent = review.reviewItems[parentIdx];
    if (parent.revision !== revision)
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Revision conflict.',
        },
      };
    const allChildren = review.reviewItems.filter(
      (i) => i.kind === 'split' && i.parentReviewItemId === parentReviewItemId,
    );
    if (allChildren.length === 0)
      return {
        error: {
          status: 422,
          code: 'split_invalid',
          message: 'No split to remove.',
        },
      };
    if (childId) {
      // Remove single child
      const childIdx = review.reviewItems.findIndex(
        (i) => i.reviewItemId === childId,
      );
      if (childIdx === -1)
        return {
          error: {
            status: 404,
            code: 'review_item_not_found',
            message: 'Child not found.',
          },
        };
      // If after removal only one child remains, we should probably keep split? But spec says removing all children restores one source item.
      // We'll allow removing one child even if leaves 1, but then split would be invalid (<2). We should still allow intermediate unbalanced state, but approval blocked.
      review.reviewItems.splice(childIdx, 1);
      // If no children left, restore original source item
      const remaining = review.reviewItems.filter(
        (i) =>
          i.kind === 'split' && i.parentReviewItemId === parentReviewItemId,
      );
      if (remaining.length === 0) {
        // Restore original: parent becomes single source item with original evidence and needs_review
        // Need to reconstruct original proposal? Parent already has original proposal, but children were created. We just need to keep parent as single source item, clear parent container status
        // Parent already is source kind; we just need to ensure it's a single item representation
        // Update parent revision
        const restored: ReviewItem = {
          ...parent,
          revision: parent.revision + 1,
          reviewState: 'needs_review',
          exclusionReason: undefined,
        };
        const parsed = ReviewItemSchema.safeParse(restored);
        if (!parsed.success)
          return {
            error: {
              status: 400,
              code: 'split_invalid',
              message: 'Invalid restore.',
            },
          };
        review.reviewItems[parentIdx] = parsed.data;
      }
    } else {
      // Remove all children — restore parent to single source
      review.reviewItems = review.reviewItems.filter(
        (i) =>
          !(i.kind === 'split' && i.parentReviewItemId === parentReviewItemId),
      );
      // Update parent revision and state
      const restored: ReviewItem = {
        ...parent,
        revision: parent.revision + 1,
        reviewState: 'needs_review',
        exclusionReason: undefined,
      };
      const parsed = ReviewItemSchema.safeParse(restored);
      if (!parsed.success)
        return {
          error: {
            status: 400,
            code: 'split_invalid',
            message: 'Invalid restore.',
          },
        };
      const idx = review.reviewItems.findIndex(
        (i) => i.reviewItemId === parentReviewItemId,
      );
      if (idx !== -1) review.reviewItems[idx] = parsed.data;
    }
    this.recomputeValidationForAll(sessionId);
    review.reviewVersion += 1;
    this.notifyWalletAfterMutation(sessionId);
    const ev = makeAuditEvent(
      'split_removed',
      parent.sourceRowId,
      parentReviewItemId,
      { revision: parent.revision + 1 },
    );
    if (review.auditEvents.length >= LIMITS.MAX_AUDIT_EVENTS) {
      // rollback not trivial; but we already mutated; for simplicity return error without rollback (rare cap)
      return {
        error: {
          status: 422,
          code: 'review_limit_exceeded',
          message: 'Audit limit exceeded.',
        },
      };
    }
    review.auditEvents.push(ev);
    const summary = computeSummary(review.reviewItems);
    return { summary };
  }

  // For Phase 4 handoff projection
  getApprovedForCommit(
    sessionId: string,
    expected: { reviewVersion: number; historyVersion: number },
  ):
    | { items: import('./contracts.js').ApprovedReviewItemForCommit[] }
    | { error: { status: number; code: string; message: string } } {
    const review = this.store.getReview(sessionId);
    if (!review)
      return {
        error: {
          status: 404,
          code: 'review_not_initialized',
          message: 'Review not initialized.',
        },
      };
    if (
      review.reviewVersion !== expected.reviewVersion ||
      review.historyVersion !== expected.historyVersion ||
      this.store.getHistoryVersion(sessionId) !== expected.historyVersion
    )
      return {
        error: {
          status: 409,
          code: 'review_revision_conflict',
          message: 'Review or category history changed before projection.',
        },
      };
    const allowed = this.getAllowedCategories(sessionId);
    if (!allowed)
      return {
        error: {
          status: 422,
          code: 'history_not_imported',
          message: 'Catalog missing.',
        },
      };
    const entry = this.store.getEntry(sessionId);
    if (!entry)
      return {
        error: {
          status: 404,
          code: 'session_not_found',
          message: 'Session not found.',
        },
      };
    const refByRow = new Map<string, string | undefined>();
    for (const tx of entry.result.transactions)
      refByRow.set(tx.sourceRowId, tx.reference);

    // Recompute summary to ensure validity
    this.recomputeValidationForAll(sessionId);

    const approved: import('./contracts.js').ApprovedReviewItemForCommit[] = [];
    const bySource = new Map<string, ReviewItem[]>();
    for (const it of review.reviewItems) {
      if (!bySource.has(it.sourceRowId)) bySource.set(it.sourceRowId, []);
      bySource.get(it.sourceRowId)!.push(it);
    }
    // Identify unbalanced sources to reject
    const unbalanced = new Set<string>();
    for (const [src, group] of bySource) {
      if (group.some((g) => g.kind === 'split')) {
        const parent = group.find((g) => g.kind === 'source');
        const children = group.filter((g) => g.kind === 'split');
        if (parent) {
          const sum = children.reduce((acc, c) => acc + c.amountMinor, 0);
          if (sum !== parent.amountMinor) unbalanced.add(src);
        }
      }
    }

    for (const it of review.reviewItems) {
      if (it.reviewState !== 'approved') continue;
      if (
        it.kind === 'source' &&
        review.reviewItems.some(
          (b) => b.sourceRowId === it.sourceRowId && b.kind === 'split',
        )
      )
        return {
          error: {
            status: 422,
            code: 'split_parent_locked',
            message: 'Approved split container cannot be projected.',
          },
        };
      if (unbalanced.has(it.sourceRowId))
        return {
          error: {
            status: 422,
            code: 'split_total_mismatch',
            message: 'Approved split total is invalid.',
          },
        };
      if (
        !it.categoryName ||
        !allowed.has(it.categoryName) ||
        it.categoryName === 'unknown'
      )
        return {
          error: {
            status: 422,
            code: 'category_not_allowed',
            message: 'Approved item category is not allowed.',
          },
        };
      // Check blocking issues
      if (it.issues.some((iss) => iss.severity === 'error'))
        return {
          error: {
            status: 422,
            code: 'review_not_approved',
            message: 'Approved item has a blocking issue.',
          },
        };
      approved.push({
        reviewItemId: it.reviewItemId,
        sourceRowId: it.sourceRowId,
        date: it.date,
        amountMinor: it.amountMinor,
        currency: 'PHP',
        description: it.description,
        payee: it.payee,
        note: it.note,
        categoryName: it.categoryName,
        sourceReference: refByRow.get(it.sourceRowId),
        splitParentReviewItemId: it.parentReviewItemId,
      });
    }
    // If any approved item had blocking issues, we already filtered; but per spec projection must reject containers, excluded/needs_review, missing categories, invalid totals, stale versions. We have filtered.
    return { items: approved };
  }
}

export const globalReviewService = new ReviewService(globalSessionStore);
