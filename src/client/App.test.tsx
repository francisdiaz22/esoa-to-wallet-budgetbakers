// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CategorizationResult,
  ExtractionResult,
  HistorySummary,
  ReviewItem,
  ReviewSummary,
} from './api';

const api = vi.hoisted(() => ({
  importStatement: vi.fn(),
  clearSession: vi.fn(),
  clearSessionOnPageExit: vi.fn(),
  importHistory: vi.fn(),
  configureProvider: vi.fn(),
  testProvider: vi.fn(),
  categorize: vi.fn(),
  initializeReview: vi.fn(),
  getReview: vi.fn(),
  getReviewItem: vi.fn(),
  patchReviewItem: vi.fn(),
  approveReviewItem: vi.fn(),
  excludeReviewItem: vi.fn(),
  returnReviewItemToReview: vi.fn(),
  reclassifyReviewItem: vi.fn(),
  createSplit: vi.fn(),
  updateSplitChild: vi.fn(),
  deleteSplitChild: vi.fn(),
  bulkApprovePreview: vi.fn(),
  bulkApprove: vi.fn(),
  exportReviewSummary: vi.fn(),
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, ...api };
});

import { App } from './App';

function resultFixture(): ExtractionResult {
  return {
    sessionId: '00000000-0000-4000-8000-000000000001',
    parserId: 'bdo-visa-gold-ph-image-v1',
    statementId: 'BDO_VGOLD_20260729',
    sourceFormat: 'ocr',
    transactions: Array.from({ length: 33 }, (_, index) => ({
      sourceRowId: `p${index < 15 ? 1 : index < 32 ? 2 : 3}-r${String(index + 1).padStart(3, '0')}`,
      statementId: 'BDO_VGOLD_20260729',
      date: '2026-07-29',
      description: `SYNTHETIC MERCHANT ${index + 1}`,
      amount: -100,
      currency: 'PHP' as const,
      source: {
        format: 'ocr',
        bankParserId: 'bdo-visa-gold-ph-image-v1',
        page: index < 15 ? 1 : index < 32 ? 2 : 3,
        row: index + 1,
        rawText: `07/29/26 SYNTHETIC MERCHANT ${index + 1} 100.00`,
      },
      extractionConfidence: 0.98,
      issues: [],
    })),
    excludedRows: [
      {
        sourceRowId: 'p1-x001',
        page: 1,
        rawText: 'PREVIOUS STATEMENT BALANCE 3,300.00',
        exclusionReason: 'previous-balance',
      },
    ],
    issues: [],
    summary: {
      proposedCount: 33,
      excludedCount: 1,
      expenseTotal: 3_300,
    },
  };
}

function imageFile(name = 'statement-page.jpg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], name, {
    type: 'image/jpeg',
  });
}

function historyFile(): File {
  return new File(['record_id;date\nsynthetic;2026-07-29'], 'history.csv', {
    type: 'text/csv',
  });
}

function categorizationFixture(): CategorizationResult {
  const outcomes = [
    'proposed',
    'unknown',
    'low_confidence',
    'provider_unavailable',
    'provider_malformed',
  ] as const;
  return {
    sessionId: resultFixture().sessionId,
    historyVersion: 1,
    proposals: outcomes.map((outcome, index) => ({
      proposalId: `proposal-${index}`,
      sourceRowId: `p1-r${String(index + 1).padStart(3, '0')}`,
      categoryName:
        outcome === 'proposed' || outcome === 'low_confidence'
          ? 'Shopping'
          : undefined,
      classificationConfidence: outcome === 'proposed' ? 0.9 : 0.3,
      rationale: `Safe ${outcome} rationale`,
      outcome,
      reviewState: 'needs_review',
      retrieval: [],
      issues: [],
    })),
    summary: {
      total: outcomes.length,
      byOutcome: Object.fromEntries(outcomes.map((outcome) => [outcome, 1])),
    },
  };
}

function reviewFixture(): {
  items: ReviewItem[];
  summary: ReviewSummary;
  reviewVersion: number;
  catalog: string[];
} {
  const proposal = categorizationFixture().proposals[0];
  return {
    items: [
      {
        reviewItemId: '00000000-0000-4000-8000-000000000101',
        kind: 'source',
        sourceRowId: 'p1-r001',
        amountMinor: -10_000,
        date: '2026-07-29',
        description: 'SYNTHETIC MERCHANT 1',
        categoryName: 'Groceries',
        reviewState: 'approved',
        proposal: { ...proposal, categoryName: 'Groceries' },
        duplicateMatches: [],
        issues: [],
        revision: 2,
      },
    ],
    summary: {
      totalItems: 1,
      sourceChargeCount: 1,
      approvedCount: 1,
      excludedCount: 0,
      needsReviewCount: 0,
      blockingCount: 0,
      warningCount: 0,
      duplicateCandidateCount: 0,
      splitSourceCount: 0,
      approvedExpenseTotalMinor: -10_000,
    },
    reviewVersion: 3,
    catalog: ['Groceries', 'Utilities'],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Phase 1 import UI', () => {
  it('supports file selection, exposes pending state, and prevents duplicate import', async () => {
    const user = userEvent.setup();
    let resolveImport: ((result: ExtractionResult) => void) | undefined;
    api.importStatement.mockImplementation(
      () =>
        new Promise<ExtractionResult>((resolve) => {
          resolveImport = resolve;
        }),
    );
    render(<App />);

    await user.upload(screen.getByLabelText(/drag a document/i), imageFile());
    const importButton = screen.getByRole('button', { name: 'Import' });
    await user.click(importButton);

    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Importing…' }));
    expect(api.importStatement).toHaveBeenCalledTimes(1);

    resolveImport?.(resultFixture());
    expect(await screen.findByText('Extraction results')).toBeInTheDocument();
  });

  it('shows a safe structured error and supports a drag/drop retry', async () => {
    const user = userEvent.setup();
    api.importStatement.mockRejectedValueOnce(
      Object.assign(new Error('Document layout was not recognized.'), {
        apiError: {
          code: 'unsupported_layout',
          stage: 'parsing',
          message: 'Document layout was not recognized.',
        },
      }),
    );
    render(<App />);

    fireEvent.drop(screen.getByLabelText('Drop zone'), {
      dataTransfer: { files: [imageFile()] },
    });
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Error [unsupported_layout] at parsing: Document layout was not recognized.',
    );
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('opens source details from the keyboard and clears all in-memory UI state without browser persistence', async () => {
    const user = userEvent.setup();
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const indexedDbOpen = vi.fn();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { open: indexedDbOpen },
    });
    api.importStatement.mockResolvedValue(resultFixture());
    api.clearSession.mockResolvedValue(undefined);
    render(<App />);

    await user.upload(screen.getByLabelText(/drag a document/i), imageFile());
    await user.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Extraction results')).toBeInTheDocument();
    expect(screen.getByText('33')).toBeInTheDocument();
    const firstRow = screen.getByRole('button', {
      name: /view details for synthetic merchant 1 on 2026-07-29/i,
    });
    firstRow.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '07/29/26 SYNTHETIC MERCHANT 1 100.00',
    );

    await user.click(screen.getByRole('button', { name: 'Clear session' }));
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));
    await waitFor(() => expect(api.clearSession).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Import statement')).toBeInTheDocument();
    expect(screen.queryByText('Extraction results')).not.toBeInTheDocument();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(indexedDbOpen).not.toHaveBeenCalled();
    storageWrite.mockRestore();
  });

  it('clears the server session when the page is reloaded or closed', async () => {
    const user = userEvent.setup();
    api.importStatement.mockResolvedValue(resultFixture());
    render(<App />);

    await user.upload(screen.getByLabelText(/drag a document/i), imageFile());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Extraction results');

    fireEvent(window, new PageTransitionEvent('pagehide'));

    expect(api.clearSessionOnPageExit).toHaveBeenCalledWith(
      resultFixture().sessionId,
    );
  });
});

describe('Phase 2 categorization UI', () => {
  async function renderExtractedApp() {
    const user = userEvent.setup();
    api.importStatement.mockResolvedValue(resultFixture());
    render(<App />);
    await user.upload(screen.getByLabelText(/drag a document/i), imageFile());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('Extraction results');
    return user;
  }

  it('covers history validation/error and announces safe status messages', async () => {
    const user = await renderExtractedApp();
    let rejectHistory: ((error: Error) => void) | undefined;
    api.importHistory.mockImplementation(
      () =>
        new Promise<HistorySummary>((_resolve, reject) => {
          rejectHistory = reject;
        }),
    );
    await user.upload(
      screen.getByLabelText(/drag wallet history/i),
      historyFile(),
    );
    await user.click(screen.getByRole('button', { name: 'Import history' }));
    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Importing Wallet history',
    );
    rejectHistory?.(
      Object.assign(new Error('Choose a supported synthetic CSV.'), {
        apiError: {
          code: 'history_schema_invalid',
          stage: 'history-validation',
          message: 'Choose a supported synthetic CSV.',
        },
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Error [history_schema_invalid] at history-validation: Choose a supported synthetic CSV.',
    );
    expect(document.body).not.toHaveTextContent('record_id;date');
  });

  it('covers provider unreachable, ready, categorizing, completed, review-only outcomes, and immediate clear', async () => {
    const user = await renderExtractedApp();
    api.importHistory.mockResolvedValue({
      recordCount: 35,
      categoryCount: 15,
      accountCount: 2,
      adapterId: 'wallet-history-csv',
      adapterVersion: '1.0.0',
      historyVersion: 1,
    });
    api.configureProvider.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:11434',
      configured: true,
    });
    api.testProvider.mockRejectedValueOnce(
      Object.assign(new Error('Local provider unreachable.'), {
        apiError: {
          code: 'provider_unavailable',
          message: 'Local provider unreachable.',
        },
      }),
    );
    await user.upload(
      screen.getByLabelText(/drag wallet history/i),
      historyFile(),
    );
    await user.click(screen.getByRole('button', { name: 'Import history' }));
    expect(await screen.findByText('History imported:')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Test local connection' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Error [provider_unavailable]: Local provider unreachable.',
    );

    api.testProvider.mockResolvedValue({
      reachable: true,
      modelLabel: 'fake-local-model',
    });
    await user.click(
      screen.getByRole('button', { name: 'Test local connection' }),
    );
    expect(
      await screen.findByText('Provider reachable — model: fake-local-model'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Local provider reachable',
    );

    let resolveCategorize: ((result: CategorizationResult) => void) | undefined;
    api.categorize.mockImplementation(
      () =>
        new Promise<CategorizationResult>((resolve) => {
          resolveCategorize = resolve;
        }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Categorize transactions' }),
    );
    expect(
      screen.getByRole('button', { name: 'Categorizing…' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('progressbar', {
        name: 'Local model categorization progress',
      }),
    ).toHaveAttribute('aria-valuetext', 'Local model is running');
    expect(screen.getByText(/local model is running/i)).toBeInTheDocument();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Categorizing transactions',
    );
    resolveCategorize?.(categorizationFixture());
    expect(
      await screen.findByText('Category proposals (read-only, advisory)'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    for (const outcome of [
      'proposed',
      'unknown',
      'low_confidence',
      'provider_unavailable',
      'provider_malformed',
    ]) {
      expect(
        screen.getByText(new RegExp(`^${outcome}.*needs review`)),
      ).toBeInTheDocument();
    }
    expect(screen.getByLabelText('Proposal status legend')).toHaveTextContent(
      'Green: proposal available',
    );
    expect(
      screen.getByLabelText('Green: proposal available; needs review'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        'Red: needs attention; low_confidence; needs review',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        'Proposal detail p1-r001: green, proposal available',
      ),
    ).toHaveTextContent('✓proposed');
    expect(
      screen.getByLabelText('Proposal detail p1-r003: red, needs attention'),
    ).toHaveTextContent('!low_confidence');
    expect(
      screen.queryByText('approved', { exact: true }),
    ).not.toBeInTheDocument();

    let resolveClear: (() => void) | undefined;
    api.clearSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Clear session' }));
    await user.click(screen.getByRole('button', { name: 'Confirm clear' }));
    expect(screen.getByText('Import statement')).toBeInTheDocument();
    expect(screen.queryByText('History imported:')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Category proposals (read-only, advisory)'),
    ).not.toBeInTheDocument();
    resolveClear?.();
  });
});

describe('Phase 3 review UI', () => {
  it('uses the server catalog, loads drawer detail, traps focus, and returns a terminal item to review', async () => {
    const user = userEvent.setup();
    const review = reviewFixture();
    api.importStatement.mockResolvedValue(resultFixture());
    api.importHistory.mockResolvedValue({
      recordCount: 35,
      categoryCount: 2,
      accountCount: 1,
      adapterId: 'test',
      adapterVersion: '1',
      historyVersion: 1,
    });
    api.configureProvider.mockResolvedValue({ configured: true });
    api.testProvider.mockResolvedValue({
      reachable: true,
      modelLabel: 'fake-local-model',
    });
    api.categorize.mockResolvedValue(categorizationFixture());
    api.initializeReview.mockResolvedValue(review);
    api.getReview.mockResolvedValue({
      ...review,
      items: [{ ...review.items[0], reviewState: 'needs_review', revision: 3 }],
    });
    api.getReviewItem.mockResolvedValue({
      ...review.items[0],
      sourceEvidence: {
        source: {
          format: 'ocr',
          bankParserId: 'test',
          page: 1,
          row: 1,
          rawText: 'SYNTHETIC DRAWER EVIDENCE',
        } as never,
        extractionConfidence: 0.98,
        issues: [],
      },
      auditSummary: [],
    });
    api.returnReviewItemToReview.mockResolvedValue({
      item: { ...review.items[0], reviewState: 'needs_review', revision: 3 },
      summary: { ...review.summary, approvedCount: 0, needsReviewCount: 1 },
    });

    render(<App />);
    await user.upload(screen.getByLabelText(/drag a document/i), imageFile());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    await user.upload(
      screen.getByLabelText(/drag wallet history/i),
      historyFile(),
    );
    await user.click(screen.getByRole('button', { name: 'Import history' }));
    await user.click(
      screen.getByRole('button', { name: 'Test local connection' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Categorize transactions' }),
    );

    expect(await screen.findAllByText('Review workspace')).toHaveLength(1);
    const details = screen.getByRole('button', {
      name: /^View details for SYNTHETIC MERCHANT 1$/,
    });
    await user.click(details);
    expect(api.getReviewItem).toHaveBeenCalledWith(
      resultFixture().sessionId,
      review.items[0].reviewItemId,
    );
    expect(
      await screen.findByText(/SYNTHETIC DRAWER EVIDENCE/),
    ).toBeInTheDocument();
    const category = screen.getByLabelText(
      'Category (from active-session catalog)',
    );
    expect(category).toHaveTextContent('Groceries');
    expect(category).toHaveTextContent('Utilities');
    expect(category).not.toHaveTextContent('Shopping');

    await user.click(screen.getByRole('button', { name: 'Return to review' }));
    expect(api.returnReviewItemToReview).toHaveBeenCalledWith(
      resultFixture().sessionId,
      review.items[0].reviewItemId,
      2,
    );
    await waitFor(() => expect(api.getReview).toHaveBeenCalled());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(details).toHaveFocus();
  });
});
