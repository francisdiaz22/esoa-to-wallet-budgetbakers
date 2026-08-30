import { describe, expect, it, beforeEach } from 'vitest';
import { SessionStore } from '../ingestion/sessionStore.js';
import { ReviewService } from './reviewService.js';
import { TemporaryWorkspace } from '../ingestion/workspace.js';
import type { ExtractionResult } from '../ingestion/contracts.js';
import type { CategoryProposal } from '../categorization/contracts.js';

function makeExtraction(): Omit<ExtractionResult, 'sessionId'> {
  const txs = Array.from({ length: 3 }, (_, i) => ({
    sourceRowId: `p1-r00${i + 1}`,
    statementId: 'BDO_VGOLD_202608',
    date: '2026-07-29',
    description: `SYNTHETIC MERCHANT ${i + 1}`,
    amount: -100 * (i + 1),
    currency: 'PHP' as const,
    source: {
      format: 'ocr' as const,
      bankParserId: 'bdo-visa-gold-ph-image-v1',
      page: 1,
      row: i + 1,
      rawText: `raw ${i}`,
    },
    extractionConfidence: 0.98,
    issues: [],
  }));
  return {
    parserId: 'bdo-visa-gold-ph-image-v1',
    statementId: 'BDO_VGOLD_202608',
    sourceFormat: 'ocr',
    transactions: txs,
    excludedRows: [],
    issues: [],
    summary: { proposedCount: 3, excludedCount: 0, expenseTotal: 600 },
  };
}

function makeProposal(
  sourceRowId: string,
  categoryName?: string,
  outcome: CategoryProposal['outcome'] = 'proposed',
): CategoryProposal {
  return {
    proposalId: `pid-${sourceRowId}`,
    sourceRowId,
    categoryName: categoryName as string,
    classificationConfidence: categoryName ? 0.9 : 0.2,
    rationale: 'test',
    outcome,
    reviewState: 'needs_review',
    retrieval: [],
    issues: [],
  } as unknown as CategoryProposal;
}

describe('ReviewService', () => {
  let store: SessionStore;
  let service: ReviewService;
  let sessionId: string;

  beforeEach(() => {
    store = new SessionStore();
    service = new ReviewService(store);
    sessionId = SessionStore.generateId();
    const ws = new TemporaryWorkspace(sessionId);
    const extraction = makeExtraction();
    store.createWithId(sessionId, extraction, ws);
    // Setup phase2
    const catalog = [
      { categoryId: '1', categoryName: 'Shopping', exampleCount: 5 },
      { categoryId: '2', categoryName: 'Food', exampleCount: 3 },
    ];
    store.setHistory(sessionId, [], catalog, {
      recordCount: 2,
      categoryCount: 2,
      accountCount: 1,
      adapterId: 'test',
      adapterVersion: '1',
      historyVersion: 0,
    });
    const proposals = [
      makeProposal('p1-r001', 'Shopping'),
      makeProposal('p1-r002', 'Food'),
      makeProposal('p1-r003', undefined, 'unknown'),
    ];
    const catResult = {
      sessionId,
      historyVersion: 1,
      proposals,
      summary: {
        total: 3,
        byOutcome: {
          proposed: 2,
          unknown: 1,
          low_confidence: 0,
          provider_unavailable: 0,
          provider_malformed: 0,
        },
      },
    };
    store.setProposals(sessionId, proposals, catResult as never, 1);
  });

  it('initializes review with one item per charge and traceable source', () => {
    const res = service.initialize(sessionId);
    expect('error' in res).toBe(false);
    if ('error' in res) return;
    expect(res.items).toHaveLength(3);
    expect(res.items.every((i) => i.sourceRowId.startsWith('p1-r'))).toBe(true);
    // extraction/proposal evidence not mutated
    const entry = store.getEntry(sessionId);
    expect(entry?.result.transactions).toHaveLength(3);
  });

  it('covers legal and illegal state transitions, revision conflicts', () => {
    const init = service.initialize(sessionId);
    if ('error' in init) throw new Error('init failed');
    const item = init.items[0];
    // Edit category moves to needs_review until approved
    const edited = service.editCategoryPayeeNote(
      sessionId,
      item.reviewItemId,
      item.revision,
      { categoryName: 'Food' },
    );
    expect('error' in edited).toBe(false);
    if ('error' in edited) return;
    expect(edited.item.categoryName).toBe('Food');
    expect(edited.item.reviewState).toBe('needs_review');
    // Approve with correct revision
    const approved = service.approveOne(
      sessionId,
      item.reviewItemId,
      edited.item.revision,
    );
    expect('error' in approved).toBe(false);
    // Revision conflict
    const conflict = service.approveOne(
      sessionId,
      item.reviewItemId,
      item.revision,
    ); // old revision
    expect(
      'error' in conflict &&
        (conflict as { error: { code: string } }).error.code ===
          'review_revision_conflict',
    ).toBe(true);
    if ('error' in approved) throw new Error('approval failed');
    const returned = service.returnToReview(
      sessionId,
      item.reviewItemId,
      approved.item.revision,
    );
    expect('error' in returned).toBe(false);
    if ('error' in returned) throw new Error('return failed');
    expect(returned.item.reviewState).toBe('needs_review');
    expect(
      store
        .getAuditEvents(sessionId)
        ?.some((event) => event.action === 'returned_to_review'),
    ).toBe(true);
  });

  it('projects only valid approved leaves and rejects stale versions', () => {
    const init = service.initialize(sessionId);
    if ('error' in init) throw new Error('init failed');
    const first = init.items[0];
    const approved = service.approveOne(
      sessionId,
      first.reviewItemId,
      first.revision,
    );
    if ('error' in approved) throw new Error('approval failed');
    const review = store.getReview(sessionId)!;
    const projected = service.getApprovedForCommit(sessionId, {
      reviewVersion: review.reviewVersion,
      historyVersion: review.historyVersion,
    });
    expect('error' in projected).toBe(false);
    if ('error' in projected) throw new Error('projection failed');
    expect(projected.items).toEqual([
      expect.objectContaining({
        reviewItemId: first.reviewItemId,
        sourceRowId: first.sourceRowId,
        amountMinor: -10_000,
        currency: 'PHP',
        categoryName: 'Shopping',
      }),
    ]);
    const stale = service.getApprovedForCommit(sessionId, {
      reviewVersion: review.reviewVersion - 1,
      historyVersion: review.historyVersion,
    });
    expect('error' in stale && stale.error.code).toBe(
      'review_revision_conflict',
    );
  });

  it('proves unknown cannot be approved without reviewer category', () => {
    const init = service.initialize(sessionId);
    if ('error' in init) throw new Error();
    const unknownItem = init.items.find((i) => i.sourceRowId === 'p1-r003')!;
    const attempt = service.approveOne(
      sessionId,
      unknownItem.reviewItemId,
      unknownItem.revision,
    );
    expect('error' in attempt).toBe(true);
    if ('error' in attempt)
      expect(attempt.error.code).toBe('category_required');
  });

  it('covers split centavo total, unbalanced intermediate, no nesting, parent lock, restoration', () => {
    const init = service.initialize(sessionId);
    if ('error' in init) throw new Error();
    const item = init.items[0];
    const amount = item.amountMinor; // -10000 for first? Actually -100
    // Create balanced split
    const splitRes = service.createSplit(
      sessionId,
      item.reviewItemId,
      item.revision,
      [
        { amountMinor: Math.trunc(amount / 2), categoryName: 'Shopping' },
        { amountMinor: amount - Math.trunc(amount / 2), categoryName: 'Food' },
      ],
    );
    expect('error' in splitRes).toBe(false);
    if ('error' in splitRes) return;
    expect(splitRes.children).toHaveLength(2);
    // Parent lock
    const parentAttempt = service.approveOne(
      sessionId,
      item.reviewItemId,
      splitRes.parent.revision,
    );
    expect(
      'error' in parentAttempt &&
        (parentAttempt as { error: { code: string } }).error.code ===
          'split_parent_locked',
    ).toBe(true);
    // No nesting: try to split a child
    const child = splitRes.children[0];
    const nestAttempt = service.createSplit(
      sessionId,
      child.reviewItemId,
      child.revision,
      [
        { amountMinor: -50, categoryName: 'Shopping' },
        { amountMinor: child.amountMinor + 50, categoryName: 'Food' },
      ],
    );
    expect('error' in nestAttempt).toBe(true);
    // Unbalanced intermediate: update child amount to make mismatch
    const unbalanced = service.updateSplitChild(
      sessionId,
      item.reviewItemId,
      child.reviewItemId,
      child.revision,
      { amountMinor: child.amountMinor + 1 },
    );
    expect('error' in unbalanced).toBe(false);
    if ('error' in unbalanced) return;
    // Now try to approve unbalanced child — should fail
    const approveUnbalanced = service.approveOne(
      sessionId,
      child.reviewItemId,
      unbalanced.child.revision,
    );
    expect(
      'error' in approveUnbalanced &&
        (approveUnbalanced as { error: { code: string } }).error.code ===
          'split_total_mismatch',
    ).toBe(true);
    // Restore by removing split
    const removed = service.removeSplit(
      sessionId,
      item.reviewItemId,
      splitRes.parent.revision,
    );
    expect('error' in removed).toBe(false);
    const review = store.getReview(sessionId);
    expect(
      review?.reviewItems.filter((i) => i.sourceRowId === item.sourceRowId),
    ).toHaveLength(1);
    expect(
      review?.reviewItems.find((i) => i.sourceRowId === item.sourceRowId)?.kind,
    ).toBe('source');
  });

  it('audit trail bounded safe fields and lifecycle removal', () => {
    const init = service.initialize(sessionId);
    if ('error' in init) throw new Error();
    const reviewBefore = store.getReview(sessionId);
    expect(reviewBefore?.auditEvents.length).toBe(1);
    expect(reviewBefore?.auditEvents[0].action).toBe('review_initialized');
    // After edit, audit grows but safeDetails excludes sensitive
    const item = init.items[0];
    service.editCategoryPayeeNote(sessionId, item.reviewItemId, item.revision, {
      categoryName: 'Food',
    });
    const after = store.getReview(sessionId);
    expect(
      after?.auditEvents.some((e) => e.action === 'category_changed'),
    ).toBe(true);
    const last = after?.auditEvents[after.auditEvents.length - 1];
    expect(last?.safeDetails).not.toHaveProperty('description');
    // Clear removes review
    store.clear(sessionId);
    expect(store.getReview(sessionId)).toBeNull();
  });

  it('history replacement invalidates review', () => {
    const init = service.initialize(sessionId);
    if ('error' in init) throw new Error();
    expect(store.getReview(sessionId)).not.toBeNull();
    store.setHistory(
      sessionId,
      [],
      [{ categoryId: '1', categoryName: 'Other', exampleCount: 1 }],
      {
        recordCount: 1,
        categoryCount: 1,
        accountCount: 1,
        adapterId: 't',
        adapterVersion: '1',
        historyVersion: 0,
      },
    );
    expect(store.getReview(sessionId)).toBeNull();
  });
});
