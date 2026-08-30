export type ExtractionResult = {
  sessionId: string;
  parserId: string;
  statementId?: string;
  sourceFormat: 'csv' | 'pdf-text' | 'ocr';
  transactions: {
    sourceRowId: string;
    statementId: string;
    date: string;
    description: string;
    amount: number;
    currency: 'PHP';
    reference?: string;
    source: {
      format: string;
      bankParserId: string;
      page?: number;
      row?: number;
      rawText: string;
    };
    extractionConfidence: number;
    issues: { code: string; severity: string; message: string }[];
  }[];
  excludedRows: {
    sourceRowId: string;
    page?: number;
    rawText: string;
    exclusionReason: string;
  }[];
  issues: { code: string; severity: string; message: string }[];
  summary: {
    proposedCount: number;
    excludedCount: number;
    expenseTotal: number;
  };
};

export type ApiError = {
  code: string;
  message: string;
  stage?: string;
  requestId?: string;
};

export async function importStatement(
  files: File[],
): Promise<ExtractionResult> {
  const form = new FormData();
  if (files.length === 1) {
    form.append('statement', files[0], files[0].name);
  } else {
    // ordered
    for (const f of files) form.append('statementPages', f, f.name);
  }
  const res = await fetch('/api/session/import', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Upload failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as ExtractionResult;
}

export async function getExtraction(
  sessionId: string,
): Promise<ExtractionResult> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/extraction`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Could not load extraction.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as ExtractionResult;
}

export async function clearSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error('Clear failed');
  }
}

/** Best-effort cleanup while the document is being reloaded or closed. */
export function clearSessionOnPageExit(sessionId: string): void {
  void fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    keepalive: true,
  });
}

export type HistorySummary = {
  recordCount: number;
  categoryCount: number;
  accountCount: number;
  adapterId: string;
  adapterVersion: string;
  historyVersion: number;
};

export type CategorizationResult = {
  sessionId: string;
  historyVersion: number;
  proposals: {
    proposalId: string;
    sourceRowId: string;
    categoryName?: string;
    classificationConfidence: number;
    rationale: string;
    outcome:
      | 'proposed'
      | 'unknown'
      | 'low_confidence'
      | 'provider_unavailable'
      | 'provider_malformed';
    reviewState: 'needs_review';
    retrieval: {
      historyRecordId: string;
      categoryName: string;
      payee?: string;
      description: string;
      amountMinor: number;
      date: string;
      score: number;
    }[];
    issues: { code: string; severity: string; message: string }[];
  }[];
  summary: { total: number; byOutcome: Record<string, number> };
};

export async function importHistory(
  sessionId: string,
  file: File,
): Promise<HistorySummary> {
  const form = new FormData();
  form.append('history', file, file.name);
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/history/import`,
    {
      method: 'POST',
      body: form,
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'History upload failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as HistorySummary;
}

export async function configureProvider(
  sessionId: string,
  baseUrl: string,
  model?: string,
): Promise<{ baseUrl: string; model?: string; configured: boolean }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/provider`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl, model }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Provider config failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as {
    baseUrl: string;
    model?: string;
    configured: boolean;
  };
}

export async function testProvider(
  sessionId: string,
): Promise<{ reachable: boolean; modelLabel?: string; message?: string }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/provider/test`,
    { method: 'POST' },
  );
  const body = (await res.json().catch(() => ({}))) as {
    reachable?: boolean;
    modelLabel?: string;
    message?: string;
    code?: string;
  };
  if (!res.ok) {
    const err: ApiError = {
      code: body.code ?? 'provider_unavailable',
      message: body.message ?? 'Provider unreachable.',
    };
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return { reachable: true, modelLabel: body.modelLabel };
}

export async function categorize(
  sessionId: string,
): Promise<CategorizationResult> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/categorize`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Categorization failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as CategorizationResult;
}

export async function getHistory(sessionId: string): Promise<HistorySummary> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/history`,
  );
  if (!res.ok) {
    const err = (await res
      .json()
      .catch(() => ({ code: 'unknown', message: 'No history.' }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as HistorySummary;
}

export async function getProposals(
  sessionId: string,
): Promise<CategorizationResult> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/proposals`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'No proposals.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as CategorizationResult;
}

export type ReviewItem = {
  reviewItemId: string;
  kind: 'source' | 'split';
  sourceRowId: string;
  parentReviewItemId?: string;
  amountMinor: number;
  date: string;
  description: string;
  payee?: string;
  note?: string;
  categoryName?: string;
  reviewState: 'needs_review' | 'approved' | 'excluded';
  exclusionReason?: string;
  proposal: CategorizationResult['proposals'][number];
  duplicateMatches: {
    candidateReviewItemId: string;
    candidateSourceRowId: string;
    matchKind: 'exact' | 'near';
    score: number;
    matchedSignals: string[];
  }[];
  issues: { code: string; severity: string; message: string }[];
  revision: number;
  sourceEvidence?: {
    source: { page?: number; row?: number; rawText: string };
    reference?: string;
    extractionConfidence: number;
    issues: { code: string; severity: string; message: string }[];
  };
  auditSummary?: {
    action: string;
    occurredAt: string;
    safeDetails: Record<string, string | number | boolean | string[]>;
  }[];
};

export type ReviewSummary = {
  totalItems: number;
  sourceChargeCount: number;
  approvedCount: number;
  excludedCount: number;
  needsReviewCount: number;
  blockingCount: number;
  warningCount: number;
  duplicateCandidateCount: number;
  splitSourceCount: number;
  approvedExpenseTotalMinor: number;
};

export async function initializeReview(sessionId: string): Promise<{
  items: ReviewItem[];
  summary: ReviewSummary;
  reviewVersion: number;
  catalog: string[];
}> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/initialize`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res
      .json()
      .catch(() => ({ code: 'unknown', message: 'Init failed.' }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as {
    items: ReviewItem[];
    summary: ReviewSummary;
    reviewVersion: number;
    catalog: string[];
  };
}

export async function getReview(sessionId: string): Promise<{
  items: ReviewItem[];
  summary: ReviewSummary;
  reviewVersion: number;
  catalog: string[];
}> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Get review failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as {
    items: ReviewItem[];
    summary: ReviewSummary;
    reviewVersion: number;
    catalog: string[];
  };
}

export async function getReviewItem(
  sessionId: string,
  reviewItemId: string,
): Promise<ReviewItem> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Get item failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as ReviewItem;
}

export async function patchReviewItem(
  sessionId: string,
  reviewItemId: string,
  revision: number,
  patch: { categoryName?: string; payee?: string | null; note?: string | null },
): Promise<{ item: ReviewItem; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision, ...patch }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Patch failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { item: ReviewItem; summary: ReviewSummary };
}

export async function approveReviewItem(
  sessionId: string,
  reviewItemId: string,
  revision: number,
): Promise<{ item: ReviewItem; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Approve failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { item: ReviewItem; summary: ReviewSummary };
}

export async function excludeReviewItem(
  sessionId: string,
  reviewItemId: string,
  revision: number,
  exclusionReason: string,
  note?: string,
): Promise<{ item: ReviewItem; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}/exclude`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision, exclusionReason, note }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Exclude failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { item: ReviewItem; summary: ReviewSummary };
}

export async function returnReviewItemToReview(
  sessionId: string,
  reviewItemId: string,
  revision: number,
): Promise<{ item: ReviewItem; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}/return-to-review`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Return to review failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { item: ReviewItem; summary: ReviewSummary };
}

export async function reclassifyReviewItem(
  sessionId: string,
  reviewItemId: string,
  revision: number,
): Promise<{ item: ReviewItem; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}/reclassify`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Reclassify failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { item: ReviewItem; summary: ReviewSummary };
}

export async function createSplit(
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
): Promise<{
  parent: ReviewItem;
  children: ReviewItem[];
  summary: ReviewSummary;
}> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(reviewItemId)}/split`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision, splits }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Split failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as {
    parent: ReviewItem;
    children: ReviewItem[];
    summary: ReviewSummary;
  };
}

export async function updateSplitChild(
  sessionId: string,
  parentId: string,
  childId: string,
  revision: number,
  patch: {
    amountMinor?: number;
    categoryName?: string;
    payee?: string | null;
    note?: string | null;
    description?: string;
  },
): Promise<{ child: ReviewItem; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(parentId)}/split-items/${encodeURIComponent(childId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision, ...patch }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Update split failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { child: ReviewItem; summary: ReviewSummary };
}

export async function deleteSplitChild(
  sessionId: string,
  parentId: string,
  childId: string,
  revision: number,
): Promise<{ summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/${encodeURIComponent(parentId)}/split-items/${encodeURIComponent(childId)}`,
    {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Delete split failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { summary: ReviewSummary };
}

export async function bulkApprovePreview(
  sessionId: string,
): Promise<{ eligibleCount: number; eligibleIds: string[] }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/bulk-approve-preview`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Preview failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { eligibleCount: number; eligibleIds: string[] };
}

export async function bulkApprove(
  sessionId: string,
  reviewVersion: number,
): Promise<{ approvedCount: number; summary: ReviewSummary }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/bulk-approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reviewVersion }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Bulk approve failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as {
    approvedCount: number;
    summary: ReviewSummary;
  };
}

export async function exportReviewSummary(sessionId: string): Promise<Blob> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/review/summary-export`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Export failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return await res.blob();
}

// ---- Phase 4 Wallet typed client ----

export type WalletSetupResponse = {
  connectionState: string;
  catalogVersion?: string;
  accounts: {
    walletAccountId: string;
    walletAccountLabel: string;
    currency: string;
    writable: boolean;
  }[];
  categories: {
    walletCategoryId: string;
    walletCategoryLabel: string;
    parentId?: string;
    isGroup?: boolean;
  }[];
  selection: {
    walletAccountId: string;
    walletAccountLabel: string;
    mappings: {
      localCategoryName: string;
      walletCategoryId: string;
      walletCategoryLabel: string;
      catalogVersion: string;
    }[];
  } | null;
  snapshotId: string | null;
  journal: {
    reviewItemId: string;
    sourceRowId: string;
    snapshotId: string;
    inputIndex?: number;
    status: string;
    walletRecordId?: string;
    safeErrorCode?: string;
    attemptCount: number;
    updatedAt: string;
  }[];
};

export type WalletDryRun = {
  snapshotId: string;
  count: number;
  totalMinor: number;
  accountLabel: string;
  catalogVersion: string;
  coverage: {
    localCategoryCount: number;
    mappedCount: number;
    fullyMapped: boolean;
  };
  items: {
    reviewItemId: string;
    sourceRowId: string;
    date: string;
    amountMinor: number;
    description: string;
    categoryName: string;
    walletCategoryLabel: string;
    splitParentReviewItemId?: string;
  }[];
  notSentYet: true;
  createdAt: string;
};

export type WalletResults = {
  journal: WalletSetupResponse['journal'];
  summary: {
    total: number;
    succeeded: number;
    clientError: number;
    serverRetry: number;
    unknown: number;
    notSubmitted: number;
  };
};

export async function connectWallet(
  sessionId: string,
  token: string,
): Promise<{ connected: boolean }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/connect`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Connect failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { connected: boolean };
}

export async function getWalletSetup(
  sessionId: string,
): Promise<WalletSetupResponse> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/setup`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Setup fetch failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as WalletSetupResponse;
}

export async function saveWalletSelection(
  sessionId: string,
  walletAccountId: string,
  mappings: { localCategoryName: string; walletCategoryId: string }[],
): Promise<{ saved: boolean }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/selection`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ walletAccountId, mappings }),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Selection failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { saved: boolean };
}

export async function createWalletDryRun(
  sessionId: string,
): Promise<WalletDryRun> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/dry-run`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Dry-run failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as WalletDryRun;
}

export async function commitWallet(
  sessionId: string,
  snapshotId: string,
): Promise<{ journal: WalletSetupResponse['journal'] }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/commit/${encodeURIComponent(snapshotId)}`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Commit failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { journal: WalletSetupResponse['journal'] };
}

export async function retryWallet(
  sessionId: string,
): Promise<{ journal: WalletSetupResponse['journal'] }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/retry`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Retry failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { journal: WalletSetupResponse['journal'] };
}

export async function getWalletResults(
  sessionId: string,
): Promise<WalletResults> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/results`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Results fetch failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as WalletResults;
}

export async function exportWalletResults(sessionId: string): Promise<Blob> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/result-summary-export`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Export failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return await res.blob();
}

export async function disconnectWallet(
  sessionId: string,
): Promise<{ disconnected: boolean }> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/wallet/disconnect`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Disconnect failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as { disconnected: boolean };
}

// ---- Phase 5 Demo + Diagnostics ----

export async function startDemo(): Promise<{
  sessionId: string;
  parserId: string;
  statementId?: string;
  summary: {
    proposedCount: number;
    excludedCount: number;
    expenseTotal: number;
  };
  historySummary: HistorySummary;
  demoVersion: string;
  fixtureId: string;
  isDemo: boolean;
  banner: string;
  walletBlocked: boolean;
}> {
  const res = await fetch('/api/demo', { method: 'POST' });
  if (!res.ok) {
    const err = (await res
      .json()
      .catch(() => ({ code: 'unknown', message: 'Demo failed.' }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as never;
}

export async function getDemoStatus(
  sessionId: string,
): Promise<{ isDemo: boolean; banner?: string }> {
  const res = await fetch(`/api/demo/${encodeURIComponent(sessionId)}/status`);
  if (!res.ok) return { isDemo: false };
  return (await res.json()) as { isDemo: boolean; banner?: string };
}

export async function previewDiagnostics(sessionId: string): Promise<unknown> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/diagnostics/preview`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Diagnostics preview failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return (await res.json()) as unknown;
}

export async function downloadDiagnostics(sessionId: string): Promise<Blob> {
  const res = await fetch(
    `/api/session/${encodeURIComponent(sessionId)}/diagnostics/download`,
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({
      code: 'unknown',
      message: 'Diagnostics download failed.',
    }))) as ApiError;
    throw Object.assign(new Error(err.message), {
      apiError: err,
      status: res.status,
    });
  }
  return await res.blob();
}
