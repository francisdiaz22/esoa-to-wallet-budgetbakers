import {
  useCallback,
  useEffect,
  useRef,
  useState,
  DragEvent,
  ChangeEvent,
  KeyboardEvent,
} from 'react';
import { OnboardingPanel } from './onboarding/OnboardingPanel';
import {
  importStatement,
  getExtraction,
  clearSession,
  clearSessionOnPageExit,
  importHistory,
  configureProvider,
  testProvider,
  categorize,
  initializeReview,
  getReview,
  getReviewItem,
  patchReviewItem,
  approveReviewItem,
  excludeReviewItem,
  returnReviewItemToReview,
  reclassifyReviewItem,
  createSplit,
  bulkApprovePreview,
  bulkApprove,
  exportReviewSummary,
  connectWallet,
  getWalletSetup,
  saveWalletSelection,
  createWalletDryRun,
  commitWallet,
  retryWallet,
  getWalletResults,
  exportWalletResults,
  disconnectWallet,
  startDemo,
  previewDiagnostics,
  downloadDiagnostics,
  type ExtractionResult,
  type ApiError,
  type HistorySummary,
  type CategorizationResult,
  type ReviewItem,
  type ReviewSummary,
  type WalletSetupResponse,
  type WalletDryRun,
  type WalletResults,
} from './api';

type Status = 'idle' | 'pending' | 'success' | 'error';
type Phase2Status = 'idle' | 'pending' | 'success' | 'error';

export function App() {
  const renderLegacyReviewWorkspace: boolean = false;
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phase 2 states
  const [historyFile, setHistoryFile] = useState<File | null>(null);
  const [historyDragOver, setHistoryDragOver] = useState(false);
  const [historyStatus, setHistoryStatus] = useState<Phase2Status>('idle');
  const [historySummary, setHistorySummary] = useState<HistorySummary | null>(
    null,
  );
  const [historyError, setHistoryError] = useState<ApiError | null>(null);
  const historyInputRef = useRef<HTMLInputElement>(null);

  const [providerBaseUrl, setProviderBaseUrl] = useState(
    'http://127.0.0.1:11434',
  );
  const [providerModel, setProviderModel] = useState('local-model');
  const [providerStatus, setProviderStatus] = useState<Phase2Status>('idle');
  const [providerTestLabel, setProviderTestLabel] = useState<string | null>(
    null,
  );
  const [providerError, setProviderError] = useState<ApiError | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);

  const [catStatus, setCatStatus] = useState<Phase2Status>('idle');
  const [catResult, setCatResult] = useState<CategorizationResult | null>(null);
  const [catError, setCatError] = useState<ApiError | null>(null);

  // Phase 3 review states
  const [reviewItems, setReviewItems] = useState<ReviewItem[] | null>(null);
  const [reviewSummary, setReviewSummary] = useState<ReviewSummary | null>(
    null,
  );
  const [reviewVersion, setReviewVersion] = useState<number | null>(null);
  const [reviewCatalog, setReviewCatalog] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [reviewStatus, setReviewStatus] = useState<Phase2Status>('idle');
  const [reviewError, setReviewError] = useState<ApiError | null>(null);
  const [reviewFilter, setReviewFilter] = useState<
    'all' | 'needs_review' | 'approved' | 'excluded' | 'warnings' | 'duplicates'
  >('all');
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerCloseBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkPreviewCount, setBulkPreviewCount] = useState<number | null>(null);
  // Detail drawer editable fields
  const [editCategory, setEditCategory] = useState<string>('');
  const [editPayee, setEditPayee] = useState<string>('');
  const [editNote, setEditNote] = useState<string>('');
  const [editExclusionReason, setEditExclusionReason] =
    useState<string>('other');
  const [splitSplits, setSplitSplits] = useState<
    { amountMinor: string; categoryName: string; payee: string; note: string }[]
  >([
    { amountMinor: '', categoryName: '', payee: '', note: '' },
    { amountMinor: '', categoryName: '', payee: '', note: '' },
  ]);
  const [showExcludeConfirm, setShowExcludeConfirm] = useState(false);
  const [showSplitConfirm, setShowSplitConfirm] = useState(false);

  // Phase 4 wallet states
  const [walletToken, setWalletToken] = useState('');
  const [walletSetup, setWalletSetup] = useState<WalletSetupResponse | null>(
    null,
  );
  const [walletSetupStatus, setWalletSetupStatus] = useState<
    'idle' | 'pending' | 'error' | 'success'
  >('idle');
  const [walletError, setWalletError] = useState<ApiError | null>(null);
  const [selectedWalletAccount, setSelectedWalletAccount] =
    useState<string>('');
  const [walletMappings, setWalletMappings] = useState<Record<string, string>>(
    {},
  );
  const [walletDryRun, setWalletDryRun] = useState<WalletDryRun | null>(null);
  const [walletResults, setWalletResults] = useState<WalletResults | null>(
    null,
  );
  const [walletCommitPending, setWalletCommitPending] = useState(false);
  const [showWalletConfirm, setShowWalletConfirm] = useState(false);
  const walletConfirmTriggerRef = useRef<HTMLButtonElement>(null);
  const walletConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const [walletRetryPending, setWalletRetryPending] = useState(false);

  useEffect(() => {
    if (showWalletConfirm) walletConfirmButtonRef.current?.focus();
  }, [showWalletConfirm]);
  const [walletThrottleWaitMs, setWalletThrottleWaitMs] = useState<
    number | null
  >(null);

  // Phase 5 demo + diagnostics (state-derived only, no browser persistence)
  const [isDemo, setIsDemo] = useState(false);
  const [demoBanner, setDemoBanner] = useState<string | null>(null);
  const [demoPending, setDemoPending] = useState(false);
  const [diagnosticsPreview, setDiagnosticsPreview] = useState<object | null>(
    null,
  );
  const [diagnosticsError, setDiagnosticsError] = useState<ApiError | null>(
    null,
  );
  const [diagnosticsPending, setDiagnosticsPending] = useState(false);

  useEffect(() => {
    const sessionId = result?.sessionId;
    if (!sessionId) return;

    const clearActiveSession = () => clearSessionOnPageExit(sessionId);
    window.addEventListener('pagehide', clearActiveSession);
    return () => window.removeEventListener('pagehide', clearActiveSession);
  }, [result?.sessionId]);

  const onFilesSelected = useCallback((list: FileList | File[]) => {
    const arr = Array.from(list);
    setFiles(arr);
    setError(null);
    setStatus('idle');
  }, []);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) onFilesSelected(e.target.files);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) onFilesSelected(e.dataTransfer.files);
  };

  const onImport = async () => {
    if (files.length === 0 || status === 'pending') return;
    setStatus('pending');
    setError(null);
    try {
      const r = await importStatement(files);
      setResult(r);
      setStatus('success');
      setSelectedId(null);
      // reset phase2 on new extraction
      setHistorySummary(null);
      setHistoryStatus('idle');
      setHistoryError(null);
      setHistoryFile(null);
      setProviderConfigured(false);
      setProviderStatus('idle');
      setProviderError(null);
      setProviderTestLabel(null);
      setCatResult(null);
      setCatStatus('idle');
      setCatError(null);
      setReviewItems(null);
      setReviewSummary(null);
      setReviewVersion(null);
      setReviewStatus('idle');
      setReviewError(null);
      setSelectedReviewId(null);
      setDrawerOpen(false);
      setWalletToken('');
      setWalletSetup(null);
      setWalletSetupStatus('idle');
      setWalletError(null);
      setSelectedWalletAccount('');
      setWalletMappings({});
      setWalletDryRun(null);
      setWalletResults(null);
      setShowWalletConfirm(false);
      setWalletThrottleWaitMs(null);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setError(err.apiError ?? { code: 'unknown', message: err.message });
      setStatus('error');
    }
  };

  const onHistoryFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (arr.length > 0) {
      setHistoryFile(arr[0]);
      setHistoryError(null);
      setHistoryStatus('idle');
    }
  };
  const onHistoryInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) onHistoryFiles(e.target.files);
  };
  const onHistoryDragOver = (e: DragEvent) => {
    e.preventDefault();
    setHistoryDragOver(true);
  };
  const onHistoryDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setHistoryDragOver(false);
  };
  const onHistoryDrop = (e: DragEvent) => {
    e.preventDefault();
    setHistoryDragOver(false);
    if (e.dataTransfer.files) onHistoryFiles(e.dataTransfer.files);
  };

  const onImportHistory = async () => {
    if (!result || !historyFile || historyStatus === 'pending') return;
    setHistoryStatus('pending');
    setHistoryError(null);
    try {
      const summary = await importHistory(result.sessionId, historyFile);
      setHistorySummary(summary);
      setHistoryStatus('success');
      // invalidate previous categorization on replacement atomically (server did), clear local
      setCatResult(null);
      setCatStatus('idle');
      setCatError(null);
      setReviewItems(null);
      setReviewSummary(null);
      setReviewVersion(null);
      setReviewStatus('idle');
      setReviewError(null);
      setWalletSetup(null);
      setWalletDryRun(null);
      setWalletResults(null);
      setSelectedWalletAccount('');
      setWalletMappings({});
      setShowWalletConfirm(false);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setHistoryError(
        err.apiError ?? { code: 'unknown', message: err.message },
      );
      setHistoryStatus('error');
    }
  };

  const onSaveProvider = async () => {
    if (!result || providerStatus === 'pending') return;
    setProviderStatus('pending');
    setProviderError(null);
    try {
      await configureProvider(
        result.sessionId,
        providerBaseUrl,
        providerModel || undefined,
      );
      setProviderConfigured(true);
      setProviderStatus('idle');
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setProviderError(
        err.apiError ?? { code: 'unknown', message: err.message },
      );
      setProviderStatus('error');
    }
  };

  const onTestProvider = async () => {
    if (!result || providerStatus === 'pending') return;
    // First ensure saved
    try {
      await configureProvider(
        result.sessionId,
        providerBaseUrl,
        providerModel || undefined,
      );
      setProviderConfigured(true);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setProviderError(
        err.apiError ?? { code: 'unknown', message: err.message },
      );
      setProviderStatus('error');
      return;
    }
    setProviderStatus('pending');
    setProviderError(null);
    try {
      const res = await testProvider(result.sessionId);
      setProviderTestLabel(res.modelLabel ?? providerModel);
      setProviderStatus('success');
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setProviderError(
        err.apiError ?? { code: 'unknown', message: err.message },
      );
      setProviderStatus('error');
    }
  };

  const onCategorize = async () => {
    if (!result || catStatus === 'pending') return;
    setCatStatus('pending');
    setCatError(null);
    try {
      const res = await categorize(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setCatResult(res);
      setCatStatus('success');
      // Auto-initialize review workspace
      setReviewStatus('pending');
      try {
        const review = await initializeReview(
          (result as unknown as { sessionId: string }).sessionId,
        );
        setReviewItems(review.items);
        setReviewSummary(review.summary);
        setReviewVersion(review.reviewVersion);
        setReviewCatalog(review.catalog);
        setReviewStatus('success');
      } catch (e) {
        const err = e as Error & { apiError?: ApiError };
        setReviewError(
          err.apiError ?? { code: 'unknown', message: err.message },
        );
        setReviewStatus('error');
      }
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setCatError(err.apiError ?? { code: 'unknown', message: err.message });
      setCatStatus('error');
    }
  };

  const refreshReview = async () => {
    if (!result) return;
    try {
      const review = await getReview(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setReviewItems(review.items);
      setReviewSummary(review.summary);
      setReviewVersion(review.reviewVersion);
      setReviewCatalog(review.catalog);
      setReviewStatus('success');
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
      setReviewStatus('error');
    }
  };

  const openDrawer = async (reviewItemId: string) => {
    lastFocusedElementRef.current = document.activeElement as HTMLElement;
    setSelectedReviewId(reviewItemId);
    setDrawerOpen(true);
    const item = reviewItems?.find((i) => i.reviewItemId === reviewItemId);
    if (item) {
      setEditCategory(item.categoryName ?? '');
      setEditPayee(item.payee ?? '');
      setEditNote(item.note ?? '');
    }
    if (!result) return;
    try {
      const detail = await getReviewItem(result.sessionId, reviewItemId);
      setEditCategory(detail.categoryName ?? '');
      setEditPayee(detail.payee ?? '');
      setEditNote(detail.note ?? '');
      setReviewItems(
        (items) =>
          items?.map((row) =>
            row.reviewItemId === reviewItemId ? detail : row,
          ) ?? null,
      );
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedReviewId(null);
    setTimeout(() => lastFocusedElementRef.current?.focus(), 0);
  };
  const handleDrawerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDrawer();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleCategoryChange = async () => {
    if (!result || !selectedReviewId || !reviewItems) return;
    const item = reviewItems.find((i) => i.reviewItemId === selectedReviewId);
    if (!item) return;
    const patch: {
      categoryName?: string;
      payee?: string | null;
      note?: string | null;
    } = {};
    if (editCategory.trim()) patch.categoryName = editCategory.trim();
    // payee/note are handled separately via their own save buttons? For now handle all together
    try {
      const res = await patchReviewItem(
        (result as unknown as { sessionId: string }).sessionId,
        selectedReviewId,
        item.revision,
        patch,
      );
      await refreshReview();
      setEditCategory(res.item.categoryName ?? '');
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handlePayeeNoteSave = async () => {
    if (!result || !selectedReviewId || !reviewItems) return;
    const item = reviewItems.find((i) => i.reviewItemId === selectedReviewId);
    if (!item) return;
    try {
      const res = await patchReviewItem(
        (result as unknown as { sessionId: string }).sessionId,
        selectedReviewId,
        item.revision,
        { payee: editPayee.trim() || null, note: editNote.trim() || null },
      );
      await refreshReview();
      setEditPayee(res.item.payee ?? '');
      setEditNote(res.item.note ?? '');
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleApprove = async () => {
    if (!result || !selectedReviewId || !reviewItems) return;
    const item = reviewItems.find((i) => i.reviewItemId === selectedReviewId);
    if (!item) return;
    try {
      await approveReviewItem(
        (result as unknown as { sessionId: string }).sessionId,
        selectedReviewId,
        item.revision,
      );
      await refreshReview();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleExclude = async () => {
    if (!result || !selectedReviewId || !reviewItems) return;
    const item = reviewItems.find((i) => i.reviewItemId === selectedReviewId);
    if (!item) return;
    try {
      await excludeReviewItem(
        (result as unknown as { sessionId: string }).sessionId,
        selectedReviewId,
        item.revision,
        editExclusionReason,
        editNote.trim() || undefined,
      );
      setShowExcludeConfirm(false);
      await refreshReview();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleReclassify = async () => {
    if (!result || !selectedReviewId || !reviewItems) return;
    const item = reviewItems.find((i) => i.reviewItemId === selectedReviewId);
    if (!item) return;
    try {
      await reclassifyReviewItem(
        (result as unknown as { sessionId: string }).sessionId,
        selectedReviewId,
        item.revision,
      );
      await refreshReview();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleCreateSplit = async () => {
    if (!result || !selectedReviewId || !reviewItems) return;
    const item = reviewItems.find((i) => i.reviewItemId === selectedReviewId);
    if (!item) return;
    const splits = splitSplits.map((s) => ({
      amountMinor: parseInt(s.amountMinor, 10),
      categoryName: s.categoryName.trim(),
      payee: s.payee.trim() || undefined,
      note: s.note.trim() || undefined,
    }));
    // Validate centavo-exact total equals source
    const sum = splits.reduce(
      (acc, s) => acc + (isNaN(s.amountMinor) ? 0 : s.amountMinor),
      0,
    );
    if (sum !== item.amountMinor) {
      setReviewError({
        code: 'split_total_mismatch',
        message: `Split total ${sum} does not equal source ${item.amountMinor}.`,
      });
      return;
    }
    try {
      await createSplit(
        (result as unknown as { sessionId: string }).sessionId,
        selectedReviewId,
        item.revision,
        splits,
      );
      setShowSplitConfirm(false);
      await refreshReview();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleBulkPreview = async () => {
    if (!result) return;
    try {
      const preview = await bulkApprovePreview(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setBulkPreviewCount(preview.eligibleCount);
      setShowBulkConfirm(true);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleBulkApprove = async () => {
    if (!result || reviewVersion === null) return;
    try {
      await bulkApprove(
        (result as unknown as { sessionId: string }).sessionId,
        reviewVersion,
      );
      setShowBulkConfirm(false);
      setBulkPreviewCount(null);
      await refreshReview();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };
  const handleExport = async () => {
    if (!result) return;
    try {
      const blob = await exportReviewSummary(
        (result as unknown as { sessionId: string }).sessionId,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'review-summary.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setReviewError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };

  // Phase 4 wallet handlers
  const refreshWalletSetup = async () => {
    if (!result) return;
    setWalletSetupStatus('pending');
    setWalletError(null);
    try {
      const setup = await getWalletSetup(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setWalletSetup(setup);
      setWalletSetupStatus('success');
      // initialise selected account/mappings from setup selection if present
      if (setup.selection) {
        setSelectedWalletAccount(setup.selection.walletAccountId);
        const map: Record<string, string> = {};
        for (const m of setup.selection.mappings)
          map[m.localCategoryName] = m.walletCategoryId;
        setWalletMappings(map);
      }
      // also refresh results
      try {
        const res = await getWalletResults(
          (result as unknown as { sessionId: string }).sessionId,
        );
        setWalletResults(res);
      } catch {
        // no results yet
      }
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
      setWalletSetupStatus('error');
    }
  };

  const handleWalletConnect = async () => {
    if (!result || !walletToken.trim()) return;
    setWalletSetupStatus('pending');
    setWalletError(null);
    try {
      await connectWallet(
        (result as unknown as { sessionId: string }).sessionId,
        walletToken.trim(),
      );
      setWalletToken('');
      await refreshWalletSetup();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
      setWalletSetupStatus('error');
    }
  };

  const handleWalletSelection = async () => {
    if (!result || !selectedWalletAccount) return;
    // Build mappings from walletMappings state
    const distinctCats = Array.from(
      new Set(
        (reviewItems ?? [])
          .filter((i) => i.reviewState === 'approved')
          .map((i) => i.categoryName)
          .filter(Boolean) as string[],
      ),
    );
    // If review not yet approved, use catResult? Fallback to review catalog
    const mappingsArray = distinctCats
      .map((cat) => ({
        localCategoryName: cat,
        walletCategoryId: walletMappings[cat],
      }))
      .filter((m) => !!m.walletCategoryId);
    if (mappingsArray.length !== distinctCats.length) {
      setWalletError({
        code: 'wallet_mapping_incomplete',
        message: 'Please map every approved category.',
      });
      return;
    }
    setWalletSetupStatus('pending');
    setWalletError(null);
    try {
      await saveWalletSelection(
        (result as unknown as { sessionId: string }).sessionId,
        selectedWalletAccount,
        mappingsArray,
      );
      await refreshWalletSetup();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
      setWalletSetupStatus('error');
    }
  };

  const handleWalletDryRun = async () => {
    if (!result) return;
    setWalletSetupStatus('pending');
    setWalletError(null);
    try {
      const dry = await createWalletDryRun(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setWalletDryRun(dry);
      setWalletSetupStatus('success');
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
      setWalletSetupStatus('error');
    }
  };

  const handleWalletCommit = async () => {
    if (!result || !walletDryRun) return;
    setWalletCommitPending(true);
    setWalletError(null);
    setWalletThrottleWaitMs(null);
    try {
      const res = await commitWallet(
        (result as unknown as { sessionId: string }).sessionId,
        walletDryRun.snapshotId,
      );
      setWalletResults({
        journal: res.journal,
        summary: {
          total: res.journal.length,
          succeeded: res.journal.filter((j) => j.status === 'succeeded').length,
          clientError: res.journal.filter((j) => j.status === 'client_error')
            .length,
          serverRetry: res.journal.filter(
            (j) => j.status === 'server_error_retryable',
          ).length,
          unknown: res.journal.filter((j) => j.status === 'unknown').length,
          notSubmitted: res.journal.filter((j) => j.status === 'not_submitted')
            .length,
        },
      });
      setShowWalletConfirm(false);
      setWalletDryRun(null);
      await refreshWalletSetup();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError; status?: number };
      // 429 throttling: expose bounded wait
      if ((err as unknown as { status: number }).status === 429) {
        setWalletThrottleWaitMs(2000);
      }
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
    } finally {
      setWalletCommitPending(false);
    }
  };

  const handleWalletRetry = async () => {
    if (!result) return;
    setWalletRetryPending(true);
    setWalletError(null);
    try {
      const res = await retryWallet(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setWalletResults({
        journal: res.journal,
        summary: {
          total: res.journal.length,
          succeeded: res.journal.filter((j) => j.status === 'succeeded').length,
          clientError: res.journal.filter((j) => j.status === 'client_error')
            .length,
          serverRetry: res.journal.filter(
            (j) => j.status === 'server_error_retryable',
          ).length,
          unknown: res.journal.filter((j) => j.status === 'unknown').length,
          notSubmitted: res.journal.filter((j) => j.status === 'not_submitted')
            .length,
        },
      });
      await refreshWalletSetup();
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
    } finally {
      setWalletRetryPending(false);
    }
  };

  const handleWalletExport = async () => {
    if (!result) return;
    try {
      const blob = await exportWalletResults(
        (result as unknown as { sessionId: string }).sessionId,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wallet-import-results.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };

  const handleWalletDisconnect = async () => {
    if (!result) return;
    try {
      await disconnectWallet(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setWalletToken('');
      await refreshWalletSetup();
      setWalletDryRun(null);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setWalletError(err.apiError ?? { code: 'unknown', message: err.message });
    }
  };

  const handleLoadDemo = async () => {
    if (demoPending) return;
    let createdSessionId: string | null = null;
    setDemoPending(true);
    setError(null);
    try {
      const demo = await startDemo();
      // Construct minimal ExtractionResult from demo response for UI continuity
      // Fetch full extraction via existing session endpoint to reuse normal paths?
      // For demo we have already run categorization + review server-side, so hydrate state
      const sid = demo.sessionId;
      createdSessionId = sid;
      const extraction = await getExtraction(sid);
      setIsDemo(true);
      setDemoBanner(demo.banner);
      // Use the normal extraction projection; the browser never reconstructs records.
      setResult(extraction);
      setStatus('success');
      setHistorySummary(demo.historySummary as HistorySummary);
      setHistoryStatus('success');
      setHistoryError(null);
      // Provider not needed for demo (baseline used), but mark configured to allow categorization UI to show demo already categorized
      setProviderConfigured(true);
      setProviderStatus('success');
      setProviderTestLabel('demo-synthetic (no network)');
      // Hydrate categorization and review via APIs
      try {
        const fetched = await getReview(sid);
        setReviewItems(fetched.items);
        setReviewSummary(fetched.summary);
        setReviewVersion(fetched.reviewVersion);
        setReviewCatalog(fetched.catalog);
        setReviewStatus('success');
        setCatStatus('success');
        setCatResult({
          sessionId: sid,
          historyVersion: demo.historySummary.historyVersion,
          proposals: [],
          summary: { total: demo.summary.proposedCount, byOutcome: {} },
        } as unknown as CategorizationResult);
      } catch {
        // review fetch failed but demo still usable
      }
    } catch (e) {
      if (createdSessionId) {
        await clearSession(createdSessionId).catch(() => undefined);
      }
      const err = e as Error & { apiError?: ApiError };
      setError(err.apiError ?? { code: 'unknown', message: err.message });
      setStatus('error');
    } finally {
      setDemoPending(false);
    }
  };

  const handlePreviewDiagnostics = async () => {
    if (!result) return;
    setDiagnosticsPending(true);
    setDiagnosticsError(null);
    try {
      const p = await previewDiagnostics(
        (result as unknown as { sessionId: string }).sessionId,
      );
      setDiagnosticsPreview(p as object);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setDiagnosticsError(
        err.apiError ?? { code: 'unknown', message: err.message },
      );
    } finally {
      setDiagnosticsPending(false);
    }
  };

  const handleDownloadDiagnostics = async () => {
    if (!result) return;
    try {
      const blob = await downloadDiagnostics(
        (result as unknown as { sessionId: string }).sessionId,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'diagnostics.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const err = e as Error & { apiError?: ApiError };
      setDiagnosticsError(
        err.apiError ?? { code: 'unknown', message: err.message },
      );
    }
  };

  const onClear = async () => {
    // Immediately remove all Phase 1 and Phase 2 content from view before awaiting server response
    const sid = result?.sessionId;
    setResult(null);
    setFiles([]);
    setError(null);
    setStatus('idle');
    setSelectedId(null);
    setShowClearConfirm(false);
    setHistoryFile(null);
    setHistorySummary(null);
    setHistoryStatus('idle');
    setHistoryError(null);
    setProviderConfigured(false);
    setProviderStatus('idle');
    setProviderError(null);
    setProviderTestLabel(null);
    setCatResult(null);
    setCatStatus('idle');
    setCatError(null);
    setReviewItems(null);
    setReviewSummary(null);
    setReviewVersion(null);
    setReviewCatalog([]);
    setReviewStatus('idle');
    setReviewError(null);
    setSelectedReviewId(null);
    setDrawerOpen(false);
    setWalletToken('');
    setWalletSetup(null);
    setWalletSetupStatus('idle');
    setWalletError(null);
    setSelectedWalletAccount('');
    setWalletMappings({});
    setWalletDryRun(null);
    setWalletResults(null);
    setWalletCommitPending(false);
    setShowWalletConfirm(false);
    setWalletRetryPending(false);
    setWalletThrottleWaitMs(null);
    setIsDemo(false);
    setDemoBanner(null);
    setDemoPending(false);
    setDiagnosticsPreview(null);
    setDiagnosticsError(null);
    setDiagnosticsPending(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (historyInputRef.current) historyInputRef.current.value = '';
    if (!sid) return;
    try {
      await clearSession(sid);
    } catch {
      setError({
        code: 'clear_failed',
        message:
          'The server could not clear this session. Your results are still available; retry clear before leaving.',
      });
    }
  };

  const selectedTx =
    result?.transactions.find((t) => t.sourceRowId === selectedId) ?? null;
  const selectedExcluded =
    result?.excludedRows.find((e) => e.sourceRowId === selectedId) ?? null;

  const formatPhp = (n: number) =>
    `PHP ${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const canCategorize =
    !!historySummary && providerConfigured && catStatus !== 'pending';

  return (
    <main
      style={{
        display: 'block',
        maxWidth: '70rem',
        margin: '0 auto',
        padding: '2rem 1rem',
      }}
    >
      <section aria-labelledby="page-title" style={{ marginBottom: '2rem' }}>
        <p className="eyebrow">OPEN SOURCE</p>
        <h1
          id="page-title"
          style={{ maxWidth: 'none', fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
        >
          eSOA to Wallet
        </h1>
        <p className="lede" style={{ maxWidth: '46rem' }}>
          Files are processed by the local service at 127.0.0.1 and cleared on
          request. No Wallet import, categorization data, or prompts leave this
          device.{' '}
          <strong>Telemetry, analytics, and remote fonts are disabled.</strong>{' '}
          Wallet is the only optional external origin.
        </p>
        {isDemo && demoBanner && (
          <div
            role="status"
            aria-live="polite"
            style={{
              background: '#fff3cd',
              border: '1px solid #ffe69c',
              color: '#664d03',
              padding: '0.75rem 1rem',
              borderRadius: 8,
              marginTop: '1rem',
              fontWeight: 600,
            }}
          >
            {demoBanner} — Wallet commit disabled. Clear the demo to start a
            live session.
          </div>
        )}
      </section>

      <OnboardingPanel
        state={{
          hasExtraction: !!result,
          hasHistory: !!historySummary,
          providerConfigured,
          providerReachable:
            providerStatus === 'success'
              ? true
              : providerStatus === 'error'
                ? false
                : null,
          hasProposals: !!catResult || !!reviewItems,
          hasReview: !!reviewItems,
          approvedCount: reviewSummary?.approvedCount ?? 0,
          needsReviewCount:
            reviewSummary?.needsReviewCount ??
            (catResult ? catResult.summary.total : 0),
          isDemo,
          extractionError: error?.code,
          historyError: historyError?.code,
          providerError: providerError?.code,
        }}
        onLoadDemo={handleLoadDemo}
        onImportStatement={() => fileInputRef.current?.focus()}
        onImportHistory={() => historyInputRef.current?.focus()}
        onConfigureProvider={() =>
          document
            .getElementById('provider-section')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        onCategorize={onCategorize}
        onReview={() =>
          document
            .getElementById('review-workspace')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        onWalletSetup={() =>
          document
            .getElementById('wallet-section')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        demoPending={demoPending}
      />

      {/* Live regions */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          left: '-10000px',
          top: 'auto',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      >
        {status === 'pending' && 'Importing statement'}
        {status === 'error' && error ? `Error: ${error.message}` : ''}
        {status === 'success' && result
          ? `Imported ${result.summary.proposedCount} transactions`
          : ''}
        {historyStatus === 'pending' && 'Importing Wallet history'}
        {historyStatus === 'success' && historySummary
          ? `History imported ${historySummary.recordCount} records`
          : ''}
        {historyStatus === 'error' && historyError
          ? `History error: ${historyError.message}`
          : ''}
        {providerStatus === 'pending' && 'Testing local provider'}
        {providerStatus === 'success' && 'Local provider reachable'}
        {catStatus === 'pending' && 'Categorizing transactions'}
        {catStatus === 'success' && catResult
          ? `Categorized ${catResult.summary.total} transactions`
          : ''}
      </div>
      <div
        aria-live="assertive"
        aria-atomic="true"
        style={{
          position: 'absolute',
          left: '-10000px',
          top: 'auto',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      >
        {error ? `Error ${error.code} ${error.message}` : ''}
        {historyError ? `History error ${historyError.code}` : ''}
        {providerError ? `Provider error ${providerError.code}` : ''}
        {catError ? `Categorization error ${catError.code}` : ''}
      </div>
      {error && (
        <div
          role="alert"
          style={{
            background: '#fdecea',
            border: '1px solid #f5c2c0',
            padding: '0.75rem 1rem',
            borderRadius: 8,
            marginBottom: '1rem',
          }}
        >
          <strong>Error [{error.code}]</strong>{' '}
          {error.stage ? `at ${error.stage}` : ''}: {error.message}
        </div>
      )}

      {!result ? (
        <section
          aria-labelledby="import-title"
          style={{
            background: '#fcfdf9',
            border: '1px solid #d4dbd4',
            borderRadius: '1rem',
            padding: '1.5rem',
          }}
        >
          <h2
            id="import-title"
            className="workflow-step-heading"
            style={{ fontSize: '1rem', margin: '0 0 1rem' }}
          >
            <span className="workflow-step-number">1</span>
            <span>Import statement</span>
          </h2>
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            aria-label="Drop zone"
            style={{
              border: `2px dashed ${dragOver ? '#285c42' : '#c3cec5'}`,
              background: dragOver ? 'rgba(40,92,66,0.06)' : 'white',
              borderRadius: 12,
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <label
              htmlFor="file-input"
              style={{
                display: 'block',
                fontWeight: 600,
                marginBottom: '0.5rem',
              }}
            >
              Drag a document (or its ordered image pages) onto the drop zone or
              select with the file picker
            </label>
            <input
              ref={fileInputRef}
              id="file-input"
              type="file"
              multiple
              accept=".csv,.pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.bmp"
              onChange={onInputChange}
              aria-describedby="file-hint privacy-notice"
              style={{ display: 'block', margin: '0.5rem auto' }}
            />
            <p id="file-hint" style={{ fontSize: '0.85rem', color: '#69736c' }}>
              Accepted: CSV, PDF, JPG/PNG/WebP/TIFF/BMP. For BDO fixture, select
              3 images in ascending page order.
            </p>
            <p
              id="privacy-notice"
              style={{ fontSize: '0.85rem', color: '#69736c' }}
            >
              Files are sent only to the local service at 127.0.0.1 and are
              removed when you clear the session. They are not stored in browser
              storage or uploaded to a remote host.
            </p>
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
              <strong>Selected:</strong>{' '}
              {files
                .map((f) => `${f.name} (${(f.size / 1024).toFixed(1)} KB)`)
                .join(', ')}
            </div>
          )}

          {/* Review workspace is rendered with the extracted-session controls below. */}
          {reviewItems && reviewSummary && renderLegacyReviewWorkspace && (
            <section
              aria-labelledby="review-title"
              style={{
                marginTop: '1.5rem',
                background: 'white',
                border: '1px solid #d4dbd4',
                borderRadius: '1rem',
                padding: '1rem',
              }}
            >
              <h2
                id="review-title"
                style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}
              >
                Review workspace
              </h2>
              {reviewError && (
                <div
                  role="alert"
                  style={{
                    background: '#fdecea',
                    border: '1px solid #f5c2c0',
                    padding: '0.75rem 1rem',
                    borderRadius: 8,
                    marginBottom: '1rem',
                  }}
                >
                  <strong>Error [{reviewError.code}]</strong>:{' '}
                  {reviewError.message}
                </div>
              )}
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  fontSize: '0.9rem',
                  marginBottom: '1rem',
                  background: '#fcfdf9',
                  border: '1px solid #d4dbd4',
                  borderRadius: 8,
                  padding: '0.75rem 1rem',
                }}
              >
                <span>
                  <strong>Needs review:</strong>{' '}
                  {reviewSummary.needsReviewCount}
                </span>
                <span>
                  <strong>Approved:</strong> {reviewSummary.approvedCount}
                </span>
                <span>
                  <strong>Excluded:</strong> {reviewSummary.excludedCount}
                </span>
                <span>
                  <strong>Blockers:</strong> {reviewSummary.blockingCount}
                </span>
                <span>
                  <strong>Duplicates:</strong>{' '}
                  {reviewSummary.duplicateCandidateCount}
                </span>
                <span>
                  <strong>Split sources:</strong>{' '}
                  {reviewSummary.splitSourceCount}
                </span>
                <span>
                  <strong>Approved total:</strong> PHP{' '}
                  {(
                    reviewSummary.approvedExpenseTotalMinor / 100
                  ).toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span>
                  <strong>Total items:</strong> {reviewSummary.totalItems}{' '}
                  (sources: {reviewSummary.sourceChargeCount})
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
                role="group"
                aria-label="Review filters"
              >
                {(
                  [
                    'all',
                    'needs_review',
                    'approved',
                    'excluded',
                    'warnings',
                    'duplicates',
                  ] as const
                ).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setReviewFilter(f)}
                    aria-pressed={reviewFilter === f}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 16,
                      border: '1px solid #285c42',
                      background: reviewFilter === f ? '#285c42' : 'white',
                      color: reviewFilter === f ? 'white' : '#285c42',
                      fontSize: '0.85rem',
                    }}
                  >
                    {f === 'all'
                      ? 'All'
                      : f === 'needs_review'
                        ? 'Needs review'
                        : f === 'warnings'
                          ? 'Warnings/errors'
                          : f === 'duplicates'
                            ? 'Duplicates'
                            : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
                {reviewFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setReviewFilter('all')}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 16,
                      border: '1px solid #c3cec5',
                      background: 'white',
                      fontSize: '0.85rem',
                    }}
                  >
                    Clear filter
                  </button>
                )}
                <span
                  aria-live="polite"
                  style={{
                    fontSize: '0.85rem',
                    color: '#69736c',
                    alignSelf: 'center',
                  }}
                >
                  {(() => {
                    const filtered = reviewItems.filter((it) => {
                      if (reviewFilter === 'all') return true;
                      if (reviewFilter === 'needs_review')
                        return it.reviewState === 'needs_review';
                      if (reviewFilter === 'approved')
                        return it.reviewState === 'approved';
                      if (reviewFilter === 'excluded')
                        return it.reviewState === 'excluded';
                      if (reviewFilter === 'warnings')
                        return it.issues.some(
                          (iss) =>
                            iss.severity === 'warning' ||
                            iss.severity === 'error',
                        );
                      if (reviewFilter === 'duplicates')
                        return it.duplicateMatches.length > 0;
                      return true;
                    });
                    return `${filtered.length} result(s)`;
                  })()}
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.88rem',
                  }}
                >
                  <thead>
                    <tr style={{ background: '#eef2eb', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.6rem' }}>State</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Date</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Description</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Amount</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Category</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>
                        Confidence/outcome
                      </th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Issues</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Duplicate</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewItems
                      .filter((it) => {
                        if (reviewFilter === 'all') return true;
                        if (reviewFilter === 'needs_review')
                          return it.reviewState === 'needs_review';
                        if (reviewFilter === 'approved')
                          return it.reviewState === 'approved';
                        if (reviewFilter === 'excluded')
                          return it.reviewState === 'excluded';
                        if (reviewFilter === 'warnings')
                          return it.issues.some(
                            (iss) =>
                              iss.severity === 'warning' ||
                              iss.severity === 'error',
                          );
                        if (reviewFilter === 'duplicates')
                          return it.duplicateMatches.length > 0;
                        return true;
                      })
                      .map((it) => (
                        <tr
                          key={it.reviewItemId}
                          style={{
                            borderTop: '1px solid #e4e9e3',
                            background:
                              it.reviewState === 'approved'
                                ? '#eef6ee'
                                : it.duplicateMatches.length
                                  ? '#fff8e6'
                                  : 'transparent',
                          }}
                        >
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            <span aria-describedby={`state-${it.reviewItemId}`}>
                              {it.reviewState}
                            </span>
                            <span
                              id={`state-${it.reviewItemId}`}
                              style={{ position: 'absolute', left: '-10000px' }}
                            >
                              {it.reviewState === 'needs_review'
                                ? 'Needs review'
                                : it.reviewState}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: '0.5rem 0.6rem',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.date}
                          </td>
                          <td
                            style={{
                              padding: '0.5rem 0.6rem',
                              maxWidth: '14rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.description}
                          </td>
                          <td
                            style={{
                              padding: '0.5rem 0.6rem',
                              whiteSpace: 'nowrap',
                              color: it.amountMinor < 0 ? '#b42318' : 'inherit',
                            }}
                          >
                            PHP{' '}
                            {(Math.abs(it.amountMinor) / 100).toLocaleString(
                              'en-PH',
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            {it.categoryName ?? '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            {(
                              it.proposal.classificationConfidence * 100
                            ).toFixed(0)}
                            % / {it.proposal.outcome}
                          </td>
                          <td
                            style={{ padding: '0.5rem 0.6rem' }}
                            aria-describedby={`issues-${it.reviewItemId}`}
                          >
                            {it.issues.length
                              ? `${it.issues.length} issue(s)`
                              : 'ok'}
                            {it.issues.length > 0 && (
                              <span
                                id={`issues-${it.reviewItemId}`}
                                style={{
                                  position: 'absolute',
                                  left: '-10000px',
                                }}
                              >
                                {it.issues
                                  .map((iss) => `${iss.code}: ${iss.message}`)
                                  .join('; ')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            {it.duplicateMatches.length
                              ? `candidate (${it.duplicateMatches[0].matchKind})`
                              : '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            <button
                              type="button"
                              onClick={() => openDrawer(it.reviewItemId)}
                              aria-label={`View details for ${it.description}`}
                              style={{
                                padding: '0.3rem 0.6rem',
                                borderRadius: 6,
                                border: '1px solid #285c42',
                                background: 'white',
                                color: '#285c42',
                                fontSize: '0.8rem',
                              }}
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  marginTop: '1rem',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <button
                  type="button"
                  onClick={handleBulkPreview}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: 8,
                    border: '1px solid #285c42',
                    background: '#285c42',
                    color: 'white',
                    fontWeight: 600,
                  }}
                >
                  Bulk approve preview
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: 8,
                    border: '1px solid #285c42',
                    background: 'white',
                    color: '#285c42',
                    fontWeight: 600,
                  }}
                >
                  Review summary
                </button>
                <span
                  style={{
                    fontSize: '0.85rem',
                    color: '#69736c',
                    alignSelf: 'center',
                  }}
                >
                  Ready for Phase 4 setup
                </span>
              </div>

              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.85rem',
                  color: '#69736c',
                }}
              >
                Approved total: PHP{' '}
                {(reviewSummary.approvedExpenseTotalMinor / 100).toLocaleString(
                  'en-PH',
                  { minimumFractionDigits: 2 },
                )}{' '}
                — Wallet writes are not part of this phase.
              </div>

              {drawerOpen &&
                selectedReviewId &&
                (() => {
                  const it = reviewItems.find(
                    (x) => x.reviewItemId === selectedReviewId,
                  );
                  if (!it) return null;
                  const sourceTx =
                    it.sourceEvidence ??
                    ((
                      result as unknown as {
                        transactions: {
                          sourceRowId: string;
                          source: {
                            page?: number;
                            row?: number;
                            rawText: string;
                          };
                          reference?: string;
                          extractionConfidence: number;
                          issues: { code: string }[];
                        }[];
                      } | null
                    )?.transactions.find(
                      (t: { sourceRowId: string }) =>
                        t.sourceRowId === it.sourceRowId,
                    ) as unknown as
                      | {
                          source: {
                            page?: number;
                            row?: number;
                            rawText: string;
                          };
                          reference?: string;
                          extractionConfidence: number;
                          issues: { code: string }[];
                        }
                      | undefined);
                  return (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="review-drawer-title"
                      onKeyDown={handleDrawerKeyDown}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          background: 'white',
                          width: 'min(32rem, 100%)',
                          height: '100%',
                          overflowY: 'auto',
                          padding: '1.5rem',
                          borderLeft: '4px solid #285c42',
                        }}
                        tabIndex={-1}
                      >
                        <h3
                          id="review-drawer-title"
                          style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}
                        >
                          Review details — {it.sourceRowId} (
                          {it.reviewItemId.slice(0, 8)}…)
                        </h3>
                        <button
                          ref={drawerCloseBtnRef}
                          type="button"
                          onClick={closeDrawer}
                          style={{
                            padding: '0.4rem 0.8rem',
                            borderRadius: 6,
                            border: '1px solid #c3cec5',
                            background: 'white',
                            marginBottom: '1rem',
                          }}
                        >
                          Close (Esc)
                        </button>

                        <dl
                          style={{
                            fontSize: '0.9rem',
                            display: 'grid',
                            gap: '0.5rem',
                          }}
                        >
                          <dt style={{ fontWeight: 600 }}>
                            Source location / excerpt
                          </dt>
                          <dd
                            style={{
                              margin: 0,
                              fontFamily: 'monospace',
                              background: '#fcfdf9',
                              padding: '0.5rem',
                              borderRadius: 6,
                              border: '1px solid #e4e9e3',
                            }}
                          >
                            {sourceTx
                              ? `p${sourceTx.source.page} r${sourceTx.source.row} — ${sourceTx.source.rawText}`
                              : 'No source'}
                            {sourceTx?.reference &&
                              ` | Reference: ${sourceTx.reference}`}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Parser evidence</dt>
                          <dd style={{ margin: 0 }}>
                            {sourceTx
                              ? `Confidence ${(sourceTx.extractionConfidence * 100).toFixed(1)}% | Issues: ${sourceTx.issues.map((i) => i.code).join(', ') || 'none'}`
                              : '—'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Model rationale</dt>
                          <dd style={{ margin: 0 }}>{it.proposal.rationale}</dd>
                          <dt style={{ fontWeight: 600 }}>
                            Retrieval examples
                          </dt>
                          <dd style={{ margin: 0 }}>
                            {it.proposal.retrieval.length
                              ? it.proposal.retrieval
                                  .map(
                                    (r: {
                                      historyRecordId: string;
                                      categoryName: string;
                                      score: number;
                                    }) =>
                                      `${r.historyRecordId}(${r.categoryName} ${r.score.toFixed(2)})`,
                                  )
                                  .join(', ')
                              : 'none'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Duplicate matches</dt>
                          <dd style={{ margin: 0 }}>
                            {it.duplicateMatches.length
                              ? it.duplicateMatches
                                  .map(
                                    (m) =>
                                      `${m.candidateSourceRowId} (${m.matchKind} ${m.score.toFixed(2)} signals: ${m.matchedSignals.join(',')})`,
                                  )
                                  .join('; ')
                              : 'no candidates — duplicate is candidate, not fact'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Issues</dt>
                          <dd style={{ margin: 0 }}>
                            {it.issues.length
                              ? it.issues
                                  .map((iss) => `${iss.code}: ${iss.message}`)
                                  .join('; ')
                              : 'none'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Audit</dt>
                          <dd style={{ margin: 0 }}>
                            Revision {it.revision} | Kind {it.kind}{' '}
                            {it.parentReviewItemId
                              ? `(parent ${it.parentReviewItemId.slice(0, 8)})`
                              : ''}
                          </dd>
                        </dl>

                        <div
                          style={{
                            marginTop: '1rem',
                            display: 'grid',
                            gap: '0.75rem',
                          }}
                        >
                          <label
                            htmlFor="drawer-category"
                            style={{ fontWeight: 600, fontSize: '0.9rem' }}
                          >
                            Category (from active-session catalog)
                          </label>
                          <select
                            id="drawer-category"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: 8,
                              border: '1px solid #c3cec5',
                            }}
                          >
                            <option value="">— select —</option>
                            {reviewCatalog.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleCategoryChange}
                            style={{
                              padding: '0.5rem 1rem',
                              borderRadius: 8,
                              border: '1px solid #285c42',
                              background: '#285c42',
                              color: 'white',
                            }}
                          >
                            Save category (→ needs review)
                          </button>

                          <label
                            htmlFor="drawer-payee"
                            style={{ fontWeight: 600, fontSize: '0.9rem' }}
                          >
                            Payee (bounded)
                          </label>
                          <input
                            id="drawer-payee"
                            type="text"
                            value={editPayee}
                            onChange={(e) => setEditPayee(e.target.value)}
                            maxLength={200}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: 8,
                              border: '1px solid #c3cec5',
                            }}
                          />

                          <label
                            htmlFor="drawer-note"
                            style={{ fontWeight: 600, fontSize: '0.9rem' }}
                          >
                            Note (bounded)
                          </label>
                          <input
                            id="drawer-note"
                            type="text"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            maxLength={500}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: 8,
                              border: '1px solid #c3cec5',
                            }}
                          />
                          <button
                            type="button"
                            onClick={handlePayeeNoteSave}
                            style={{
                              padding: '0.5rem 1rem',
                              borderRadius: 8,
                              border: '1px solid #285c42',
                              background: 'white',
                              color: '#285c42',
                            }}
                          >
                            Save payee/note
                          </button>

                          <div
                            style={{
                              display: 'flex',
                              gap: '0.5rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              onClick={handleApprove}
                              disabled={
                                !!it.issues.find(
                                  (iss) => iss.severity === 'error',
                                )
                              }
                              aria-describedby={
                                it.issues.find(
                                  (iss) => iss.severity === 'error',
                                )
                                  ? `approve-block-${it.reviewItemId}`
                                  : undefined
                              }
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: it.issues.find(
                                  (iss) => iss.severity === 'error',
                                )
                                  ? '#ccc'
                                  : '#285c42',
                                color: 'white',
                                border: 'none',
                                fontWeight: 600,
                              }}
                            >
                              Approve
                            </button>
                            {it.issues.find(
                              (iss) => iss.severity === 'error',
                            ) && (
                              <span
                                id={`approve-block-${it.reviewItemId}`}
                                style={{
                                  fontSize: '0.85rem',
                                  color: '#b42318',
                                }}
                              >
                                Blocked:{' '}
                                {
                                  it.issues.find(
                                    (iss) => iss.severity === 'error',
                                  )?.code
                                }
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowExcludeConfirm(true)}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: 'white',
                                border: '1px solid #b42318',
                                color: '#b42318',
                              }}
                            >
                              Exclude
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!result || !selectedReviewId) return;
                                const it2 = reviewItems.find(
                                  (x) => x.reviewItemId === selectedReviewId,
                                );
                                if (!it2) return;
                                await returnReviewItemToReview(
                                  (result as unknown as { sessionId: string })
                                    .sessionId,
                                  selectedReviewId,
                                  it2.revision,
                                );
                                await refreshReview();
                              }}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: 'white',
                                border: '1px solid #c3cec5',
                              }}
                            >
                              Return to review
                            </button>
                            <button
                              type="button"
                              onClick={handleReclassify}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: 'white',
                                border: '1px solid #285c42',
                                color: '#285c42',
                              }}
                            >
                              Re-categorize
                            </button>
                          </div>

                          {showExcludeConfirm && (
                            <div
                              role="dialog"
                              aria-modal="true"
                              aria-labelledby="exclude-confirm-title"
                              style={{
                                background: '#fff',
                                border: '2px solid #b42318',
                                borderRadius: 8,
                                padding: '1rem',
                              }}
                            >
                              <h4
                                id="exclude-confirm-title"
                                style={{ margin: '0 0 0.5rem' }}
                              >
                                Confirm exclusion
                              </h4>
                              <label
                                htmlFor="exclude-reason"
                                style={{ fontWeight: 600, fontSize: '0.9rem' }}
                              >
                                Reason
                              </label>
                              <select
                                id="exclude-reason"
                                value={editExclusionReason}
                                onChange={(e) =>
                                  setEditExclusionReason(e.target.value)
                                }
                                style={{
                                  padding: '0.5rem',
                                  borderRadius: 6,
                                  border: '1px solid #c3cec5',
                                  marginBottom: '0.5rem',
                                  width: '100%',
                                }}
                              >
                                <option value="not_a_transaction">
                                  not_a_transaction
                                </option>
                                <option value="duplicate_confirmed">
                                  duplicate_confirmed
                                </option>
                                <option value="out_of_scope">
                                  out_of_scope
                                </option>
                                <option value="other">other</option>
                              </select>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                  type="button"
                                  onClick={handleExclude}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: 6,
                                    background: '#b42318',
                                    color: 'white',
                                    border: 'none',
                                  }}
                                >
                                  Confirm exclude
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowExcludeConfirm(false)}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: 6,
                                    background: 'white',
                                    border: '1px solid #c3cec5',
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          <div
                            style={{
                              borderTop: '1px solid #e4e9e3',
                              paddingTop: '1rem',
                              marginTop: '0.5rem',
                            }}
                          >
                            <h4
                              style={{
                                margin: '0 0 0.5rem',
                                fontSize: '0.95rem',
                              }}
                            >
                              Split editor (one level, centavo-exact)
                            </h4>
                            {splitSplits.map((s, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'grid',
                                  gap: '0.4rem',
                                  marginBottom: '0.75rem',
                                  border: '1px solid #e4e9e3',
                                  borderRadius: 8,
                                  padding: '0.75rem',
                                }}
                              >
                                <strong>Child {idx + 1}</strong>
                                <label style={{ fontSize: '0.85rem' }}>
                                  Amount (centavos, signed)
                                </label>
                                <input
                                  type="number"
                                  value={s.amountMinor}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? {
                                              ...p,
                                              amountMinor: e.target.value,
                                            }
                                          : p,
                                      ),
                                    )
                                  }
                                  placeholder="e.g. -50000"
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                <label style={{ fontSize: '0.85rem' }}>
                                  Category
                                </label>
                                <input
                                  type="text"
                                  value={s.categoryName}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? {
                                              ...p,
                                              categoryName: e.target.value,
                                            }
                                          : p,
                                      ),
                                    )
                                  }
                                  placeholder="Shopping"
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                <label style={{ fontSize: '0.85rem' }}>
                                  Payee
                                </label>
                                <input
                                  type="text"
                                  value={s.payee}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? { ...p, payee: e.target.value }
                                          : p,
                                      ),
                                    )
                                  }
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                <label style={{ fontSize: '0.85rem' }}>
                                  Note
                                </label>
                                <input
                                  type="text"
                                  value={s.note}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? { ...p, note: e.target.value }
                                          : p,
                                      ),
                                    )
                                  }
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                {splitSplits.length > 2 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSplitSplits((prev) =>
                                        prev.filter((_, i) => i !== idx),
                                      )
                                    }
                                    style={{
                                      padding: '0.3rem 0.6rem',
                                      borderRadius: 6,
                                      border: '1px solid #c3cec5',
                                      background: 'white',
                                      fontSize: '0.8rem',
                                    }}
                                  >
                                    Remove child
                                  </button>
                                )}
                              </div>
                            ))}
                            <div
                              style={{
                                fontSize: '0.85rem',
                                marginBottom: '0.5rem',
                              }}
                            >
                              Remaining:{' '}
                              {(() => {
                                const sum = splitSplits.reduce(
                                  (acc, s) =>
                                    acc +
                                    (parseInt(s.amountMinor || '0', 10) || 0),
                                  0,
                                );
                                const remaining = it.amountMinor - sum;
                                return `${remaining} centavos (${(remaining / 100).toFixed(2)})`;
                              })()}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setSplitSplits((prev) => [
                                  ...prev,
                                  {
                                    amountMinor: '',
                                    categoryName: '',
                                    payee: '',
                                    note: '',
                                  },
                                ])
                              }
                              style={{
                                padding: '0.4rem 0.8rem',
                                borderRadius: 6,
                                border: '1px solid #c3cec5',
                                background: 'white',
                                fontSize: '0.85rem',
                              }}
                            >
                              Add child
                            </button>
                            {!showSplitConfirm ? (
                              <button
                                type="button"
                                onClick={() => setShowSplitConfirm(true)}
                                style={{
                                  marginLeft: '0.5rem',
                                  padding: '0.4rem 0.8rem',
                                  borderRadius: 6,
                                  border: '1px solid #285c42',
                                  background: '#285c42',
                                  color: 'white',
                                  fontSize: '0.85rem',
                                }}
                              >
                                Create split
                              </button>
                            ) : (
                              <span
                                style={{
                                  marginLeft: '0.5rem',
                                  background: '#fff',
                                  border: '1px solid #f5c2c0',
                                  borderRadius: 6,
                                  padding: '0.4rem 0.6rem',
                                  fontSize: '0.85rem',
                                }}
                              >
                                Confirm split?{' '}
                                <button
                                  type="button"
                                  onClick={handleCreateSplit}
                                  style={{
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: 4,
                                    background: '#285c42',
                                    color: 'white',
                                    border: 'none',
                                    marginRight: '0.3rem',
                                  }}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowSplitConfirm(false)}
                                  style={{
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: 4,
                                    background: 'white',
                                    border: '1px solid #c3cec5',
                                  }}
                                >
                                  Cancel
                                </button>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {showBulkConfirm && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="bulk-confirm-title"
                  style={{
                    marginTop: '1rem',
                    background: '#fff',
                    border: '2px solid #285c42',
                    borderRadius: 8,
                    padding: '1rem',
                  }}
                >
                  <h4 id="bulk-confirm-title" style={{ margin: '0 0 0.5rem' }}>
                    Bulk approve preview
                  </h4>
                  <p style={{ fontSize: '0.9rem' }}>
                    {bulkPreviewCount} item(s) eligible for bulk approve
                    (non-flagged, non-duplicate, category present, needs
                    review).
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleBulkApprove}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: 6,
                        background: '#285c42',
                        color: 'white',
                        border: 'none',
                      }}
                    >
                      Confirm bulk approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBulkConfirm(false)}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: 6,
                        background: 'white',
                        border: '1px solid #c3cec5',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={onImport}
              disabled={files.length === 0 || status === 'pending'}
              aria-disabled={files.length === 0 || status === 'pending'}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                border: '1px solid #285c42',
                background:
                  files.length === 0 || status === 'pending'
                    ? '#ccc'
                    : '#285c42',
                color: 'white',
                fontWeight: 600,
                cursor:
                  files.length === 0 || status === 'pending'
                    ? 'not-allowed'
                    : 'pointer',
              }}
            >
              {status === 'pending' ? 'Importing…' : 'Import'}
            </button>
            {files.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFiles([]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                  setError(null);
                }}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: 8,
                  border: '1px solid #c3cec5',
                  background: 'white',
                }}
              >
                Clear selection
              </button>
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby="results-title">
          <div
            style={{
              background: '#fcfdf9',
              border: '1px solid #d4dbd4',
              borderRadius: '1rem',
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            <h2 id="results-title" style={{ margin: '0 0 0.5rem' }}>
              Extraction results
            </h2>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                fontSize: '0.95rem',
              }}
            >
              <span>
                <strong>Parser:</strong> {result.parserId}
              </span>
              <span>
                <strong>Source format:</strong> {result.sourceFormat}
              </span>
              <span>
                <strong>Proposed:</strong> {result.summary.proposedCount}
              </span>
              <span>
                <strong>Excluded:</strong> {result.summary.excludedCount}
              </span>
              <span>
                <strong>Total (abs):</strong>{' '}
                {formatPhp(result.summary.expenseTotal)}
              </span>
            </div>
            <p
              style={{
                fontSize: '0.85rem',
                color: '#69736c',
                margin: '0.5rem 0 0',
              }}
            >
              Session {result.sessionId.slice(0, 8)}… — validation{' '}
              {result.issues.length === 0
                ? 'ok'
                : `${result.issues.length} issue(s)`}
              . Use source details to audit each row.
            </p>
          </div>

          <div
            style={{
              overflowX: 'auto',
              background: 'white',
              border: '1px solid #d4dbd4',
              borderRadius: '1rem',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.9rem',
              }}
            >
              <thead>
                <tr style={{ background: '#eef2eb', textAlign: 'left' }}>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Date</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Description</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Amount</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Page/Row</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Confidence</th>
                  <th style={{ padding: '0.6rem 0.75rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.transactions.map((tx) => (
                  <tr
                    key={tx.sourceRowId}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${tx.description} on ${tx.date}`}
                    onClick={() => setSelectedId(tx.sourceRowId)}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedId(tx.sourceRowId);
                      }
                    }}
                    style={{
                      borderTop: '1px solid #e4e9e3',
                      cursor: 'pointer',
                      background:
                        selectedId === tx.sourceRowId
                          ? '#f0f7f2'
                          : 'transparent',
                    }}
                  >
                    <td
                      style={{
                        padding: '0.55rem 0.75rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tx.date}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      {tx.description}
                    </td>
                    <td
                      style={{
                        padding: '0.55rem 0.75rem',
                        whiteSpace: 'nowrap',
                        color: tx.amount < 0 ? '#b42318' : 'inherit',
                      }}
                    >
                      {formatPhp(Math.abs(tx.amount))}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      p{tx.source.page} r{tx.source.row}
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      {(tx.extractionConfidence * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: '0.55rem 0.75rem' }}>
                      {tx.issues.length ? `${tx.issues.length} issue(s)` : 'ok'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.excludedRows.length > 0 && (
            <details
              style={{
                marginTop: '1rem',
                background: '#fff',
                border: '1px solid #d4dbd4',
                borderRadius: 8,
                padding: '0.75rem 1rem',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Excluded source rows ({result.excludedRows.length})
              </summary>
              <ul
                style={{
                  marginTop: '0.5rem',
                  paddingLeft: '1.25rem',
                  fontSize: '0.9rem',
                }}
              >
                {result.excludedRows.map((ex) => (
                  <li key={ex.sourceRowId} style={{ marginBottom: '0.25rem' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(ex.sourceRowId)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#285c42',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        font: 'inherit',
                        padding: 0,
                      }}
                    >
                      {ex.sourceRowId}
                    </button>{' '}
                    p{ex.page} — {ex.rawText} ({ex.exclusionReason})
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(selectedTx || selectedExcluded) && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="detail-title"
              style={{
                marginTop: '1rem',
                background: '#fcfdf9',
                border: '2px solid #285c42',
                borderRadius: 12,
                padding: '1rem',
              }}
            >
              <h3
                id="detail-title"
                style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}
              >
                Source details — {selectedId}
              </h3>
              {selectedTx ? (
                <dl
                  style={{
                    margin: 0,
                    fontSize: '0.9rem',
                    display: 'grid',
                    gap: '0.35rem',
                  }}
                >
                  <dt style={{ fontWeight: 600 }}>Page / Row</dt>
                  <dd style={{ margin: 0 }}>
                    {selectedTx.source.page} / {selectedTx.source.row}
                  </dd>
                  <dt style={{ fontWeight: 600 }}>Parser ID</dt>
                  <dd style={{ margin: 0 }}>
                    {selectedTx.source.bankParserId}
                  </dd>
                  <dt style={{ fontWeight: 600 }}>Raw excerpt</dt>
                  <dd
                    style={{
                      margin: 0,
                      fontFamily: 'monospace',
                      background: '#fff',
                      padding: '0.5rem',
                      borderRadius: 6,
                      border: '1px solid #e4e9e3',
                    }}
                  >
                    {selectedTx.source.rawText}
                  </dd>
                  {selectedTx.reference && (
                    <>
                      <dt style={{ fontWeight: 600 }}>Reference</dt>
                      <dd style={{ margin: 0 }}>{selectedTx.reference}</dd>
                    </>
                  )}
                  <dt style={{ fontWeight: 600 }}>Issues</dt>
                  <dd style={{ margin: 0 }}>
                    {selectedTx.issues.length
                      ? selectedTx.issues
                          .map((i) => `${i.code}: ${i.message}`)
                          .join('; ')
                      : 'none'}
                  </dd>
                  <dt style={{ fontWeight: 600 }}>Confidence</dt>
                  <dd style={{ margin: 0 }}>
                    {(selectedTx.extractionConfidence * 100).toFixed(1)}%
                  </dd>
                </dl>
              ) : (
                <dl
                  style={{
                    margin: 0,
                    fontSize: '0.9rem',
                    display: 'grid',
                    gap: '0.35rem',
                  }}
                >
                  <dt style={{ fontWeight: 600 }}>Page</dt>
                  <dd style={{ margin: 0 }}>{selectedExcluded?.page}</dd>
                  <dt style={{ fontWeight: 600 }}>Raw excerpt</dt>
                  <dd
                    style={{
                      margin: 0,
                      fontFamily: 'monospace',
                      background: '#fff',
                      padding: '0.5rem',
                      borderRadius: 6,
                      border: '1px solid #e4e9e3',
                    }}
                  >
                    {selectedExcluded?.rawText}
                  </dd>
                  <dt style={{ fontWeight: 600 }}>Exclusion reason</dt>
                  <dd style={{ margin: 0 }}>
                    {selectedExcluded?.exclusionReason}
                  </dd>
                </dl>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                style={{
                  marginTop: '0.75rem',
                  padding: '0.45rem 0.9rem',
                  borderRadius: 8,
                  border: '1px solid #c3cec5',
                  background: 'white',
                }}
              >
                Close details
              </button>
            </div>
          )}

          {/* Phase 2: History import */}
          <section
            aria-labelledby="history-title"
            style={{
              marginTop: '2rem',
              background: '#fcfdf9',
              border: '1px solid #d4dbd4',
              borderRadius: '1rem',
              padding: '1.5rem',
            }}
          >
            <h2
              id="history-title"
              className="workflow-step-heading"
              style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}
            >
              <span className="workflow-step-number">2</span>
              <span>Wallet history (local session only)</span>
            </h2>
            <p
              style={{
                fontSize: '0.85rem',
                color: '#69736c',
                margin: '0 0 1rem',
              }}
            >
              Import a Wallet-native comma-delimited export or the synthetic
              semicolon-delimited history CSV. It is used only to suggest
              categories in this session and is cleared with the session.
            </p>
            {historySummary && (
              <div
                role="status"
                style={{
                  background: '#eef6ee',
                  border: '1px solid #b9d8b9',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                <strong>History imported:</strong> {historySummary.recordCount}{' '}
                records, {historySummary.categoryCount} categories,{' '}
                {historySummary.accountCount} accounts. Adapter{' '}
                {historySummary.adapterId} v{historySummary.adapterVersion}.
                {historySummary.historyVersion > 1 && (
                  <span style={{ marginLeft: '0.5rem', color: '#b42318' }}>
                    Replacement will invalidate prior proposals.
                  </span>
                )}
              </div>
            )}
            {historyError && (
              <div
                role="alert"
                style={{
                  background: '#fdecea',
                  border: '1px solid #f5c2c0',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  marginBottom: '1rem',
                }}
              >
                <strong>Error [{historyError.code}]</strong>
                {historyError.stage ? ` at ${historyError.stage}` : ''}:{' '}
                {historyError.message}
              </div>
            )}
            <div
              onDragOver={onHistoryDragOver}
              onDragLeave={onHistoryDragLeave}
              onDrop={onHistoryDrop}
              aria-label="Drop zone for Wallet history"
              style={{
                border: `2px dashed ${historyDragOver ? '#285c42' : '#c3cec5'}`,
                background: historyDragOver ? 'rgba(40,92,66,0.06)' : 'white',
                borderRadius: 12,
                padding: '1.5rem',
                textAlign: 'center',
              }}
            >
              <label
                htmlFor="history-file-input"
                style={{
                  display: 'block',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                }}
              >
                Drag Wallet history CSV onto the drop zone or select with the
                file picker
              </label>
              <input
                ref={historyInputRef}
                id="history-file-input"
                type="file"
                accept=".csv"
                onChange={onHistoryInputChange}
                aria-describedby="history-hint"
                style={{ display: 'block', margin: '0.5rem auto' }}
              />
              <p
                id="history-hint"
                style={{ fontSize: '0.85rem', color: '#69736c' }}
              >
                Accepted: Wallet-native comma-delimited export or synthetic
                semicolon-delimited CSV. PHP only. Max 5 MiB / 10,000 rows.
              </p>
            </div>
            {historyFile && (
              <div style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
                <strong>Selected:</strong> {historyFile.name} (
                {(historyFile.size / 1024).toFixed(1)} KB)
              </div>
            )}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={onImportHistory}
                disabled={!historyFile || historyStatus === 'pending'}
                aria-disabled={!historyFile || historyStatus === 'pending'}
                style={{
                  padding: '0.6rem 1.2rem',
                  borderRadius: 8,
                  border: '1px solid #285c42',
                  background:
                    !historyFile || historyStatus === 'pending'
                      ? '#ccc'
                      : '#285c42',
                  color: 'white',
                  fontWeight: 600,
                  cursor:
                    !historyFile || historyStatus === 'pending'
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {historyStatus === 'pending'
                  ? 'Importing…'
                  : historySummary
                    ? 'Replace history'
                    : 'Import history'}
              </button>
              {historyFile && (
                <button
                  type="button"
                  onClick={() => {
                    setHistoryFile(null);
                    if (historyInputRef.current)
                      historyInputRef.current.value = '';
                    setHistoryError(null);
                  }}
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: 8,
                    border: '1px solid #c3cec5',
                    background: 'white',
                  }}
                >
                  Clear selection
                </button>
              )}
            </div>
          </section>

          {/* Phase 2: Provider setup */}
          <section
            id="provider-section"
            aria-labelledby="provider-title"
            style={{
              marginTop: '1.5rem',
              background: '#fcfdf9',
              border: '1px solid #d4dbd4',
              borderRadius: '1rem',
              padding: '1.5rem',
            }}
          >
            <h2
              id="provider-title"
              className="workflow-step-heading"
              style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}
            >
              <span className="workflow-step-number">3</span>
              <span>Local model provider (loopback only)</span>
            </h2>
            <p
              style={{
                fontSize: '0.85rem',
                color: '#69736c',
                margin: '0 0 1rem',
              }}
            >
              Configure a local OpenAI-compatible endpoint (e.g., Ollama). URL
              must be loopback (127.0.0.1 or ::1). No cloud URL, credentials, or
              proxy is permitted. Use <strong>Test local connection</strong> to
              verify without sending statement data.
            </p>
            {providerError && (
              <div
                role="alert"
                style={{
                  background: '#fdecea',
                  border: '1px solid #f5c2c0',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  marginBottom: '1rem',
                }}
              >
                <strong>Error [{providerError.code}]</strong>
                {providerError.stage ? ` at ${providerError.stage}` : ''}:{' '}
                {providerError.message}
              </div>
            )}
            {providerStatus === 'success' && providerTestLabel && (
              <div
                role="status"
                style={{
                  background: '#eef6ee',
                  border: '1px solid #b9d8b9',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                Provider reachable — model: {providerTestLabel}
              </div>
            )}
            <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '32rem' }}>
              <label
                htmlFor="provider-baseUrl"
                style={{ fontWeight: 600, fontSize: '0.9rem' }}
              >
                Base URL
              </label>
              <input
                id="provider-baseUrl"
                type="url"
                value={providerBaseUrl}
                onChange={(e) => setProviderBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:11434"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #c3cec5',
                }}
              />
              <label
                htmlFor="provider-model"
                style={{ fontWeight: 600, fontSize: '0.9rem' }}
              >
                Model (optional)
              </label>
              <input
                id="provider-model"
                type="text"
                value={providerModel}
                onChange={(e) => setProviderModel(e.target.value)}
                placeholder="local-model"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid #c3cec5',
                }}
              />
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={onSaveProvider}
                disabled={providerStatus === 'pending'}
                aria-disabled={providerStatus === 'pending'}
                style={{
                  padding: '0.6rem 1.2rem',
                  borderRadius: 8,
                  border: '1px solid #285c42',
                  background: providerStatus === 'pending' ? '#ccc' : 'white',
                  color: '#285c42',
                  fontWeight: 600,
                  cursor:
                    providerStatus === 'pending' ? 'not-allowed' : 'pointer',
                }}
              >
                Save provider
              </button>
              <button
                type="button"
                onClick={onTestProvider}
                disabled={providerStatus === 'pending'}
                aria-disabled={providerStatus === 'pending'}
                style={{
                  padding: '0.6rem 1.2rem',
                  borderRadius: 8,
                  border: '1px solid #285c42',
                  background: providerStatus === 'pending' ? '#ccc' : '#285c42',
                  color: 'white',
                  fontWeight: 600,
                  cursor:
                    providerStatus === 'pending' ? 'not-allowed' : 'pointer',
                }}
              >
                {providerStatus === 'pending'
                  ? 'Testing…'
                  : 'Test local connection'}
              </button>
            </div>
            {providerConfigured && (
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#69736c',
                  marginTop: '0.5rem',
                }}
              >
                Provider saved for this session only; cleared on session clear.
              </p>
            )}
          </section>

          {/* Phase 2: Categorization */}
          <section
            aria-labelledby="categorize-title"
            style={{
              marginTop: '1.5rem',
              background: '#fcfdf9',
              border: '1px solid #d4dbd4',
              borderRadius: '1rem',
              padding: '1.5rem',
            }}
          >
            <h2
              id="categorize-title"
              style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}
            >
              Categorization
            </h2>
            {catError && (
              <div
                role="alert"
                style={{
                  background: '#fdecea',
                  border: '1px solid #f5c2c0',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  marginBottom: '1rem',
                }}
              >
                <strong>Error [{catError.code}]</strong>
                {catError.stage ? ` at ${catError.stage}` : ''}:{' '}
                {catError.message}
              </div>
            )}
            <p
              style={{
                fontSize: '0.85rem',
                color: '#69736c',
                margin: '0 0 1rem',
              }}
            >
              Requires imported history and a tested local provider. Proposals
              are advisory and remain <strong>needs review</strong> until
              explicit approval in a later phase. Replacing history invalidates
              prior proposals.
            </p>
            <button
              type="button"
              onClick={onCategorize}
              disabled={!canCategorize}
              aria-disabled={!canCategorize}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                border: '1px solid #285c42',
                background: !canCategorize ? '#ccc' : '#285c42',
                color: 'white',
                fontWeight: 600,
                cursor: !canCategorize ? 'not-allowed' : 'pointer',
              }}
            >
              {catStatus === 'pending'
                ? 'Categorizing…'
                : 'Categorize transactions'}
            </button>
            {catStatus === 'pending' && (
              <div className="model-progress" aria-live="polite">
                <div
                  className="model-progress__track"
                  role="progressbar"
                  aria-label="Local model categorization progress"
                  aria-valuetext="Local model is running"
                >
                  <span className="model-progress__indicator" />
                </div>
                <p className="model-progress__label">
                  Local model is running… This can take a moment.
                </p>
              </div>
            )}
            {!historySummary && (
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#b42318',
                  marginTop: '0.5rem',
                }}
              >
                Import Wallet history before categorizing.
              </p>
            )}
            {historySummary && !providerConfigured && (
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#b42318',
                  marginTop: '0.5rem',
                }}
              >
                Configure and test a local provider before categorizing.
              </p>
            )}
          </section>

          {catResult && (
            <section
              aria-labelledby="proposals-title"
              style={{
                marginTop: '1.5rem',
                background: 'white',
                border: '1px solid #d4dbd4',
                borderRadius: '1rem',
                padding: '1rem',
              }}
            >
              <h2
                id="proposals-title"
                style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}
              >
                Category proposals (read-only, advisory)
              </h2>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  fontSize: '0.9rem',
                  marginBottom: '1rem',
                }}
              >
                <span>
                  <strong>Total:</strong> {catResult.summary.total}
                </span>
                {Object.entries(catResult.summary.byOutcome).map(([k, v]) => (
                  <span key={k}>
                    <strong>{k}:</strong> {v}
                  </span>
                ))}
              </div>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#69736c',
                  margin: '0 0 1rem',
                }}
              >
                Categories are from your active-session history or{' '}
                <code>unknown</code>. Unknown, low-confidence, unavailable, and
                malformed outcomes are <strong>needs review</strong> and not
                approved. See rationale and evidence before the future review
                stage.
              </p>
              <div
                aria-label="Proposal status legend"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  margin: '0 0 0.75rem',
                  fontSize: '0.8rem',
                }}
              >
                <span style={{ color: '#176b35', fontWeight: 600 }}>
                  <span aria-hidden="true">●</span> Green: proposal available
                </span>
                <span style={{ color: '#a12622', fontWeight: 600 }}>
                  <span aria-hidden="true">●</span> Red: needs attention
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.88rem',
                  }}
                >
                  <thead>
                    <tr style={{ background: '#eef2eb', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Source</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Category</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Confidence</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Rationale</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Outcome</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catResult.proposals.map((p) => (
                      <tr
                        key={p.proposalId}
                        style={{
                          borderTop: '1px solid #e4e9e3',
                          borderLeft: `4px solid ${
                            p.outcome === 'proposed' ? '#2e8b57' : '#c43d38'
                          }`,
                          background:
                            p.outcome === 'proposed' ? '#f4fbf6' : '#fff5f4',
                        }}
                      >
                        <td
                          style={{
                            padding: '0.5rem 0.6rem',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {p.sourceRowId}
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem' }}>
                          {p.categoryName ?? '—'}
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem' }}>
                          {(p.classificationConfidence * 100).toFixed(0)}%
                        </td>
                        <td
                          style={{
                            padding: '0.5rem 0.6rem',
                            maxWidth: '18rem',
                          }}
                        >
                          {p.rationale}
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem' }}>
                          <span
                            aria-label={
                              p.outcome === 'proposed'
                                ? 'Green: proposal available; needs review'
                                : `Red: needs attention; ${p.outcome}; needs review`
                            }
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: 4,
                              background:
                                p.outcome === 'proposed'
                                  ? '#e6f4ea'
                                  : '#fdecea',
                              border: `1px solid ${p.outcome === 'proposed' ? '#b7e1c5' : '#f5c2c0'}`,
                              color:
                                p.outcome === 'proposed'
                                  ? '#176b35'
                                  : '#a12622',
                              fontWeight: 600,
                              fontSize: '0.8rem',
                            }}
                          >
                            <span aria-hidden="true">
                              {p.outcome === 'proposed' ? '✓' : '!'}
                            </span>
                            {p.outcome}{' '}
                            {p.reviewState === 'needs_review'
                              ? '(needs review)'
                              : ''}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem 0.6rem' }}>
                          {p.retrieval.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details
                style={{
                  marginTop: '1rem',
                  background: '#fcfdf9',
                  border: '1px solid #d4dbd4',
                  borderRadius: 8,
                  padding: '0.75rem 1rem',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}
                >
                  Proposal details
                </summary>
                <ul
                  style={{
                    marginTop: '0.5rem',
                    paddingLeft: 0,
                    listStyle: 'none',
                    fontSize: '0.85rem',
                  }}
                >
                  {catResult.proposals.map((p) => (
                    <li
                      key={p.proposalId}
                      aria-label={`Proposal detail ${p.sourceRowId}: ${
                        p.outcome === 'proposed'
                          ? 'green, proposal available'
                          : 'red, needs attention'
                      }`}
                      style={{
                        marginBottom: '0.5rem',
                        padding: '0.65rem 0.75rem',
                        borderLeft: `4px solid ${
                          p.outcome === 'proposed' ? '#2e8b57' : '#c43d38'
                        }`,
                        borderRadius: 4,
                        background:
                          p.outcome === 'proposed' ? '#f4fbf6' : '#fff5f4',
                      }}
                    >
                      <strong>{p.sourceRowId}</strong> →{' '}
                      {p.categoryName ?? 'unknown'}{' '}
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.1rem 0.35rem',
                          borderRadius: 4,
                          background:
                            p.outcome === 'proposed' ? '#e6f4ea' : '#fdecea',
                          border: `1px solid ${
                            p.outcome === 'proposed' ? '#b7e1c5' : '#f5c2c0'
                          }`,
                          color:
                            p.outcome === 'proposed' ? '#176b35' : '#a12622',
                          fontWeight: 600,
                        }}
                      >
                        <span aria-hidden="true">
                          {p.outcome === 'proposed' ? '✓' : '!'}
                        </span>
                        {p.outcome}
                      </span>{' '}
                      — {p.rationale} — evidence:{' '}
                      {p.retrieval
                        .map((r) => `${r.historyRecordId}(${r.categoryName})`)
                        .join(', ') || 'none'}{' '}
                      {p.issues.length
                        ? `issues: ${p.issues
                            .map((i) => `${i.code}: ${i.message}`)
                            .join('; ')}`
                        : ''}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          {/* Phase 3: Review Workspace */}
          {reviewItems && reviewSummary && (
            <section
              id="review-workspace"
              aria-labelledby="review-title"
              style={{
                marginTop: '1.5rem',
                background: 'white',
                border: '1px solid #d4dbd4',
                borderRadius: '1rem',
                padding: '1rem',
              }}
            >
              <h2
                id="review-title"
                className="workflow-step-heading"
                style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}
              >
                <span className="workflow-step-number">4</span>
                <span>Review workspace</span>
              </h2>
              {reviewError && (
                <div
                  role="alert"
                  style={{
                    background: '#fdecea',
                    border: '1px solid #f5c2c0',
                    padding: '0.75rem 1rem',
                    borderRadius: 8,
                    marginBottom: '1rem',
                  }}
                >
                  <strong>Error [{reviewError.code}]</strong>:{' '}
                  {reviewError.message}
                </div>
              )}
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1rem',
                  fontSize: '0.9rem',
                  marginBottom: '1rem',
                  background: '#fcfdf9',
                  border: '1px solid #d4dbd4',
                  borderRadius: 8,
                  padding: '0.75rem 1rem',
                }}
              >
                <span>
                  <strong>Needs review:</strong>{' '}
                  {reviewSummary.needsReviewCount}
                </span>
                <span>
                  <strong>Approved:</strong> {reviewSummary.approvedCount}
                </span>
                <span>
                  <strong>Excluded:</strong> {reviewSummary.excludedCount}
                </span>
                <span>
                  <strong>Blockers:</strong> {reviewSummary.blockingCount}
                </span>
                <span>
                  <strong>Duplicates:</strong>{' '}
                  {reviewSummary.duplicateCandidateCount}
                </span>
                <span>
                  <strong>Split sources:</strong>{' '}
                  {reviewSummary.splitSourceCount}
                </span>
                <span>
                  <strong>Approved total:</strong> PHP{' '}
                  {(
                    reviewSummary.approvedExpenseTotalMinor / 100
                  ).toLocaleString('en-PH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span>
                  <strong>Total items:</strong> {reviewSummary.totalItems}{' '}
                  (sources: {reviewSummary.sourceChargeCount})
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
                role="group"
                aria-label="Review filters"
              >
                {(
                  [
                    'all',
                    'needs_review',
                    'approved',
                    'excluded',
                    'warnings',
                    'duplicates',
                  ] as const
                ).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setReviewFilter(f)}
                    aria-pressed={reviewFilter === f}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 16,
                      border: '1px solid #285c42',
                      background: reviewFilter === f ? '#285c42' : 'white',
                      color: reviewFilter === f ? 'white' : '#285c42',
                      fontSize: '0.85rem',
                    }}
                  >
                    {f === 'all'
                      ? 'All'
                      : f === 'needs_review'
                        ? 'Needs review'
                        : f === 'warnings'
                          ? 'Warnings/errors'
                          : f === 'duplicates'
                            ? 'Duplicates'
                            : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
                {reviewFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setReviewFilter('all')}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 16,
                      border: '1px solid #c3cec5',
                      background: 'white',
                      fontSize: '0.85rem',
                    }}
                  >
                    Clear filter
                  </button>
                )}
                <span
                  aria-live="polite"
                  style={{
                    fontSize: '0.85rem',
                    color: '#69736c',
                    alignSelf: 'center',
                  }}
                >
                  {(() => {
                    const filtered = reviewItems.filter((it) => {
                      if (reviewFilter === 'all') return true;
                      if (reviewFilter === 'needs_review')
                        return it.reviewState === 'needs_review';
                      if (reviewFilter === 'approved')
                        return it.reviewState === 'approved';
                      if (reviewFilter === 'excluded')
                        return it.reviewState === 'excluded';
                      if (reviewFilter === 'warnings')
                        return it.issues.some(
                          (iss) =>
                            iss.severity === 'warning' ||
                            iss.severity === 'error',
                        );
                      if (reviewFilter === 'duplicates')
                        return it.duplicateMatches.length > 0;
                      return true;
                    });
                    return `${filtered.length} result(s)`;
                  })()}
                </span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.88rem',
                  }}
                >
                  <thead>
                    <tr style={{ background: '#eef2eb', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.6rem' }}>State</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Date</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Description</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Amount</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Category</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>
                        Confidence/outcome
                      </th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Issues</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Duplicate</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewItems
                      .filter((it) => {
                        if (reviewFilter === 'all') return true;
                        if (reviewFilter === 'needs_review')
                          return it.reviewState === 'needs_review';
                        if (reviewFilter === 'approved')
                          return it.reviewState === 'approved';
                        if (reviewFilter === 'excluded')
                          return it.reviewState === 'excluded';
                        if (reviewFilter === 'warnings')
                          return it.issues.some(
                            (iss) =>
                              iss.severity === 'warning' ||
                              iss.severity === 'error',
                          );
                        if (reviewFilter === 'duplicates')
                          return it.duplicateMatches.length > 0;
                        return true;
                      })
                      .map((it) => (
                        <tr
                          key={it.reviewItemId}
                          style={{
                            borderTop: '1px solid #e4e9e3',
                            background:
                              it.reviewState === 'approved'
                                ? '#eef6ee'
                                : it.duplicateMatches.length
                                  ? '#fff8e6'
                                  : 'transparent',
                          }}
                        >
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            <span aria-describedby={`state-${it.reviewItemId}`}>
                              {it.reviewState}
                            </span>
                            <span
                              id={`state-${it.reviewItemId}`}
                              style={{ position: 'absolute', left: '-10000px' }}
                            >
                              {it.reviewState === 'needs_review'
                                ? 'Needs review'
                                : it.reviewState}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: '0.5rem 0.6rem',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.date}
                          </td>
                          <td
                            style={{
                              padding: '0.5rem 0.6rem',
                              maxWidth: '14rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {it.description}
                          </td>
                          <td
                            style={{
                              padding: '0.5rem 0.6rem',
                              whiteSpace: 'nowrap',
                              color: it.amountMinor < 0 ? '#b42318' : 'inherit',
                            }}
                          >
                            PHP{' '}
                            {(Math.abs(it.amountMinor) / 100).toLocaleString(
                              'en-PH',
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            {it.categoryName ?? '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            {(
                              it.proposal.classificationConfidence * 100
                            ).toFixed(0)}
                            % / {it.proposal.outcome}
                          </td>
                          <td
                            style={{ padding: '0.5rem 0.6rem' }}
                            aria-describedby={`issues-${it.reviewItemId}`}
                          >
                            {it.issues.length
                              ? `${it.issues.length} issue(s)`
                              : 'ok'}
                            {it.issues.length > 0 && (
                              <span
                                id={`issues-${it.reviewItemId}`}
                                style={{
                                  position: 'absolute',
                                  left: '-10000px',
                                }}
                              >
                                {it.issues
                                  .map((iss) => `${iss.code}: ${iss.message}`)
                                  .join('; ')}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            {it.duplicateMatches.length
                              ? `candidate (${it.duplicateMatches[0].matchKind})`
                              : '—'}
                          </td>
                          <td style={{ padding: '0.5rem 0.6rem' }}>
                            <button
                              type="button"
                              onClick={() => openDrawer(it.reviewItemId)}
                              aria-label={`View details for ${it.description}`}
                              style={{
                                padding: '0.3rem 0.6rem',
                                borderRadius: 6,
                                border: '1px solid #285c42',
                                background: 'white',
                                color: '#285c42',
                                fontSize: '0.8rem',
                              }}
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div
                style={{
                  marginTop: '1rem',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <button
                  type="button"
                  onClick={handleBulkPreview}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: 8,
                    border: '1px solid #285c42',
                    background: '#285c42',
                    color: 'white',
                    fontWeight: 600,
                  }}
                >
                  Bulk approve preview
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: 8,
                    border: '1px solid #285c42',
                    background: 'white',
                    color: '#285c42',
                    fontWeight: 600,
                  }}
                >
                  Review summary
                </button>
                <span
                  style={{
                    fontSize: '0.85rem',
                    color: '#69736c',
                    alignSelf: 'center',
                  }}
                >
                  Ready for Phase 4 setup
                </span>
              </div>

              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.85rem',
                  color: '#69736c',
                }}
              >
                Approved total: PHP{' '}
                {(reviewSummary.approvedExpenseTotalMinor / 100).toLocaleString(
                  'en-PH',
                  { minimumFractionDigits: 2 },
                )}{' '}
                — Wallet writes are not part of this phase.
              </div>

              {drawerOpen &&
                selectedReviewId &&
                (() => {
                  const it = reviewItems.find(
                    (x) => x.reviewItemId === selectedReviewId,
                  );
                  if (!it) return null;
                  const sourceTx =
                    it.sourceEvidence ??
                    ((
                      result as unknown as {
                        transactions: {
                          sourceRowId: string;
                          source: {
                            page?: number;
                            row?: number;
                            rawText: string;
                          };
                          reference?: string;
                          extractionConfidence: number;
                          issues: { code: string }[];
                        }[];
                      } | null
                    )?.transactions.find(
                      (t: { sourceRowId: string }) =>
                        t.sourceRowId === it.sourceRowId,
                    ) as unknown as
                      | {
                          source: {
                            page?: number;
                            row?: number;
                            rawText: string;
                          };
                          reference?: string;
                          extractionConfidence: number;
                          issues: { code: string }[];
                        }
                      | undefined);
                  return (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="review-drawer-title"
                      onKeyDown={handleDrawerKeyDown}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        zIndex: 50,
                      }}
                    >
                      <div
                        style={{
                          background: 'white',
                          width: 'min(32rem, 100%)',
                          height: '100%',
                          overflowY: 'auto',
                          padding: '1.5rem',
                          borderLeft: '4px solid #285c42',
                        }}
                        tabIndex={-1}
                      >
                        <h3
                          id="review-drawer-title"
                          style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}
                        >
                          Review details — {it.sourceRowId} (
                          {it.reviewItemId.slice(0, 8)}…)
                        </h3>
                        <button
                          ref={drawerCloseBtnRef}
                          type="button"
                          onClick={closeDrawer}
                          style={{
                            padding: '0.4rem 0.8rem',
                            borderRadius: 6,
                            border: '1px solid #c3cec5',
                            background: 'white',
                            marginBottom: '1rem',
                          }}
                        >
                          Close (Esc)
                        </button>

                        <dl
                          style={{
                            fontSize: '0.9rem',
                            display: 'grid',
                            gap: '0.5rem',
                          }}
                        >
                          <dt style={{ fontWeight: 600 }}>
                            Source location / excerpt
                          </dt>
                          <dd
                            style={{
                              margin: 0,
                              fontFamily: 'monospace',
                              background: '#fcfdf9',
                              padding: '0.5rem',
                              borderRadius: 6,
                              border: '1px solid #e4e9e3',
                            }}
                          >
                            {sourceTx
                              ? `p${sourceTx.source.page} r${sourceTx.source.row} — ${sourceTx.source.rawText}`
                              : 'No source'}
                            {sourceTx?.reference &&
                              ` | Reference: ${sourceTx.reference}`}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Parser evidence</dt>
                          <dd style={{ margin: 0 }}>
                            {sourceTx
                              ? `Confidence ${(sourceTx.extractionConfidence * 100).toFixed(1)}% | Issues: ${sourceTx.issues.map((i) => i.code).join(', ') || 'none'}`
                              : '—'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Model rationale</dt>
                          <dd style={{ margin: 0 }}>{it.proposal.rationale}</dd>
                          <dt style={{ fontWeight: 600 }}>
                            Retrieval examples
                          </dt>
                          <dd style={{ margin: 0 }}>
                            {it.proposal.retrieval.length
                              ? it.proposal.retrieval
                                  .map(
                                    (r: {
                                      historyRecordId: string;
                                      categoryName: string;
                                      score: number;
                                    }) =>
                                      `${r.historyRecordId}(${r.categoryName} ${r.score.toFixed(2)})`,
                                  )
                                  .join(', ')
                              : 'none'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Duplicate matches</dt>
                          <dd style={{ margin: 0 }}>
                            {it.duplicateMatches.length
                              ? it.duplicateMatches
                                  .map(
                                    (m) =>
                                      `${m.candidateSourceRowId} (${m.matchKind} ${m.score.toFixed(2)} signals: ${m.matchedSignals.join(',')})`,
                                  )
                                  .join('; ')
                              : 'no candidates — duplicate is candidate, not fact'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Issues</dt>
                          <dd style={{ margin: 0 }}>
                            {it.issues.length
                              ? it.issues
                                  .map((iss) => `${iss.code}: ${iss.message}`)
                                  .join('; ')
                              : 'none'}
                          </dd>
                          <dt style={{ fontWeight: 600 }}>Audit</dt>
                          <dd style={{ margin: 0 }}>
                            Revision {it.revision} | Kind {it.kind}{' '}
                            {it.parentReviewItemId
                              ? `(parent ${it.parentReviewItemId.slice(0, 8)})`
                              : ''}
                          </dd>
                        </dl>

                        <div
                          style={{
                            marginTop: '1rem',
                            display: 'grid',
                            gap: '0.75rem',
                          }}
                        >
                          <label
                            htmlFor="drawer-category"
                            style={{ fontWeight: 600, fontSize: '0.9rem' }}
                          >
                            Category (from active-session catalog)
                          </label>
                          <select
                            id="drawer-category"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: 8,
                              border: '1px solid #c3cec5',
                            }}
                          >
                            <option value="">— select —</option>
                            {reviewCatalog.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleCategoryChange}
                            style={{
                              padding: '0.5rem 1rem',
                              borderRadius: 8,
                              border: '1px solid #285c42',
                              background: '#285c42',
                              color: 'white',
                            }}
                          >
                            Save category (→ needs review)
                          </button>

                          <label
                            htmlFor="drawer-payee"
                            style={{ fontWeight: 600, fontSize: '0.9rem' }}
                          >
                            Payee (bounded)
                          </label>
                          <input
                            id="drawer-payee"
                            type="text"
                            value={editPayee}
                            onChange={(e) => setEditPayee(e.target.value)}
                            maxLength={200}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: 8,
                              border: '1px solid #c3cec5',
                            }}
                          />

                          <label
                            htmlFor="drawer-note"
                            style={{ fontWeight: 600, fontSize: '0.9rem' }}
                          >
                            Note (bounded)
                          </label>
                          <input
                            id="drawer-note"
                            type="text"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            maxLength={500}
                            style={{
                              padding: '0.5rem 0.75rem',
                              borderRadius: 8,
                              border: '1px solid #c3cec5',
                            }}
                          />
                          <button
                            type="button"
                            onClick={handlePayeeNoteSave}
                            style={{
                              padding: '0.5rem 1rem',
                              borderRadius: 8,
                              border: '1px solid #285c42',
                              background: 'white',
                              color: '#285c42',
                            }}
                          >
                            Save payee/note
                          </button>

                          <div
                            style={{
                              display: 'flex',
                              gap: '0.5rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              onClick={handleApprove}
                              disabled={
                                !!it.issues.find(
                                  (iss) => iss.severity === 'error',
                                )
                              }
                              aria-describedby={
                                it.issues.find(
                                  (iss) => iss.severity === 'error',
                                )
                                  ? `approve-block-${it.reviewItemId}`
                                  : undefined
                              }
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: it.issues.find(
                                  (iss) => iss.severity === 'error',
                                )
                                  ? '#ccc'
                                  : '#285c42',
                                color: 'white',
                                border: 'none',
                                fontWeight: 600,
                              }}
                            >
                              Approve
                            </button>
                            {it.issues.find(
                              (iss) => iss.severity === 'error',
                            ) && (
                              <span
                                id={`approve-block-${it.reviewItemId}`}
                                style={{
                                  fontSize: '0.85rem',
                                  color: '#b42318',
                                }}
                              >
                                Blocked:{' '}
                                {
                                  it.issues.find(
                                    (iss) => iss.severity === 'error',
                                  )?.code
                                }
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setShowExcludeConfirm(true)}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: 'white',
                                border: '1px solid #b42318',
                                color: '#b42318',
                              }}
                            >
                              Exclude
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!result || !selectedReviewId) return;
                                const it2 = reviewItems.find(
                                  (x) => x.reviewItemId === selectedReviewId,
                                );
                                if (!it2) return;
                                await returnReviewItemToReview(
                                  (result as unknown as { sessionId: string })
                                    .sessionId,
                                  selectedReviewId,
                                  it2.revision,
                                );
                                await refreshReview();
                              }}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: 'white',
                                border: '1px solid #c3cec5',
                              }}
                            >
                              Return to review
                            </button>
                            <button
                              type="button"
                              onClick={handleReclassify}
                              style={{
                                padding: '0.6rem 1rem',
                                borderRadius: 8,
                                background: 'white',
                                border: '1px solid #285c42',
                                color: '#285c42',
                              }}
                            >
                              Re-categorize
                            </button>
                          </div>

                          {showExcludeConfirm && (
                            <div
                              role="dialog"
                              aria-modal="true"
                              aria-labelledby="exclude-confirm-title"
                              style={{
                                background: '#fff',
                                border: '2px solid #b42318',
                                borderRadius: 8,
                                padding: '1rem',
                              }}
                            >
                              <h4
                                id="exclude-confirm-title"
                                style={{ margin: '0 0 0.5rem' }}
                              >
                                Confirm exclusion
                              </h4>
                              <label
                                htmlFor="exclude-reason"
                                style={{ fontWeight: 600, fontSize: '0.9rem' }}
                              >
                                Reason
                              </label>
                              <select
                                id="exclude-reason"
                                value={editExclusionReason}
                                onChange={(e) =>
                                  setEditExclusionReason(e.target.value)
                                }
                                style={{
                                  padding: '0.5rem',
                                  borderRadius: 6,
                                  border: '1px solid #c3cec5',
                                  marginBottom: '0.5rem',
                                  width: '100%',
                                }}
                              >
                                <option value="not_a_transaction">
                                  not_a_transaction
                                </option>
                                <option value="duplicate_confirmed">
                                  duplicate_confirmed
                                </option>
                                <option value="out_of_scope">
                                  out_of_scope
                                </option>
                                <option value="other">other</option>
                              </select>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                  type="button"
                                  onClick={handleExclude}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: 6,
                                    background: '#b42318',
                                    color: 'white',
                                    border: 'none',
                                  }}
                                >
                                  Confirm exclude
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowExcludeConfirm(false)}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: 6,
                                    background: 'white',
                                    border: '1px solid #c3cec5',
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          <div
                            style={{
                              borderTop: '1px solid #e4e9e3',
                              paddingTop: '1rem',
                              marginTop: '0.5rem',
                            }}
                          >
                            <h4
                              style={{
                                margin: '0 0 0.5rem',
                                fontSize: '0.95rem',
                              }}
                            >
                              Split editor (one level, centavo-exact)
                            </h4>
                            {splitSplits.map((s, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'grid',
                                  gap: '0.4rem',
                                  marginBottom: '0.75rem',
                                  border: '1px solid #e4e9e3',
                                  borderRadius: 8,
                                  padding: '0.75rem',
                                }}
                              >
                                <strong>Child {idx + 1}</strong>
                                <label style={{ fontSize: '0.85rem' }}>
                                  Amount (centavos, signed)
                                </label>
                                <input
                                  type="number"
                                  value={s.amountMinor}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? {
                                              ...p,
                                              amountMinor: e.target.value,
                                            }
                                          : p,
                                      ),
                                    )
                                  }
                                  placeholder="e.g. -50000"
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                <label style={{ fontSize: '0.85rem' }}>
                                  Category
                                </label>
                                <input
                                  type="text"
                                  value={s.categoryName}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? {
                                              ...p,
                                              categoryName: e.target.value,
                                            }
                                          : p,
                                      ),
                                    )
                                  }
                                  placeholder="Shopping"
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                <label style={{ fontSize: '0.85rem' }}>
                                  Payee
                                </label>
                                <input
                                  type="text"
                                  value={s.payee}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? { ...p, payee: e.target.value }
                                          : p,
                                      ),
                                    )
                                  }
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                <label style={{ fontSize: '0.85rem' }}>
                                  Note
                                </label>
                                <input
                                  type="text"
                                  value={s.note}
                                  onChange={(e) =>
                                    setSplitSplits((prev) =>
                                      prev.map((p, i) =>
                                        i === idx
                                          ? { ...p, note: e.target.value }
                                          : p,
                                      ),
                                    )
                                  }
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                  }}
                                />
                                {splitSplits.length > 2 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSplitSplits((prev) =>
                                        prev.filter((_, i) => i !== idx),
                                      )
                                    }
                                    style={{
                                      padding: '0.3rem 0.6rem',
                                      borderRadius: 6,
                                      border: '1px solid #c3cec5',
                                      background: 'white',
                                      fontSize: '0.8rem',
                                    }}
                                  >
                                    Remove child
                                  </button>
                                )}
                              </div>
                            ))}
                            <div
                              style={{
                                fontSize: '0.85rem',
                                marginBottom: '0.5rem',
                              }}
                            >
                              Remaining:{' '}
                              {(() => {
                                const sum = splitSplits.reduce(
                                  (acc, s) =>
                                    acc +
                                    (parseInt(s.amountMinor || '0', 10) || 0),
                                  0,
                                );
                                const remaining = it.amountMinor - sum;
                                return `${remaining} centavos (${(remaining / 100).toFixed(2)})`;
                              })()}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setSplitSplits((prev) => [
                                  ...prev,
                                  {
                                    amountMinor: '',
                                    categoryName: '',
                                    payee: '',
                                    note: '',
                                  },
                                ])
                              }
                              style={{
                                padding: '0.4rem 0.8rem',
                                borderRadius: 6,
                                border: '1px solid #c3cec5',
                                background: 'white',
                                fontSize: '0.85rem',
                              }}
                            >
                              Add child
                            </button>
                            {!showSplitConfirm ? (
                              <button
                                type="button"
                                onClick={() => setShowSplitConfirm(true)}
                                style={{
                                  marginLeft: '0.5rem',
                                  padding: '0.4rem 0.8rem',
                                  borderRadius: 6,
                                  border: '1px solid #285c42',
                                  background: '#285c42',
                                  color: 'white',
                                  fontSize: '0.85rem',
                                }}
                              >
                                Create split
                              </button>
                            ) : (
                              <span
                                style={{
                                  marginLeft: '0.5rem',
                                  background: '#fff',
                                  border: '1px solid #f5c2c0',
                                  borderRadius: 6,
                                  padding: '0.4rem 0.6rem',
                                  fontSize: '0.85rem',
                                }}
                              >
                                Confirm split?{' '}
                                <button
                                  type="button"
                                  onClick={handleCreateSplit}
                                  style={{
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: 4,
                                    background: '#285c42',
                                    color: 'white',
                                    border: 'none',
                                    marginRight: '0.3rem',
                                  }}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setShowSplitConfirm(false)}
                                  style={{
                                    padding: '0.3rem 0.6rem',
                                    borderRadius: 4,
                                    background: 'white',
                                    border: '1px solid #c3cec5',
                                  }}
                                >
                                  Cancel
                                </button>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

              {showBulkConfirm && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="bulk-confirm-title"
                  style={{
                    marginTop: '1rem',
                    background: '#fff',
                    border: '2px solid #285c42',
                    borderRadius: 8,
                    padding: '1rem',
                  }}
                >
                  <h4 id="bulk-confirm-title" style={{ margin: '0 0 0.5rem' }}>
                    Bulk approve preview
                  </h4>
                  <p style={{ fontSize: '0.9rem' }}>
                    {bulkPreviewCount} item(s) eligible for bulk approve
                    (non-flagged, non-duplicate, category present, needs
                    review).
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleBulkApprove}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: 6,
                        background: '#285c42',
                        color: 'white',
                        border: 'none',
                      }}
                    >
                      Confirm bulk approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBulkConfirm(false)}
                      style={{
                        padding: '0.5rem 1rem',
                        borderRadius: 6,
                        background: 'white',
                        border: '1px solid #c3cec5',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Phase 4 Wallet Commit */}
          {reviewSummary && (reviewSummary.approvedCount > 0 || isDemo) && (
            <section
              id="wallet-section"
              aria-labelledby="wallet-title"
              style={{
                marginTop: '1.5rem',
                background: '#fcfdf9',
                border: '1px solid #d4dbd4',
                borderRadius: '1rem',
                padding: '1.5rem',
              }}
            >
              <h2
                id="wallet-title"
                className="workflow-step-heading"
                style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}
              >
                <span className="workflow-step-number">5</span>
                <span>Wallet commit — sends data externally</span>
              </h2>
              {isDemo && (
                <div
                  role="note"
                  style={{
                    background: '#fff3cd',
                    border: '1px solid #ffe69c',
                    padding: '0.75rem 1rem',
                    borderRadius: 8,
                    marginBottom: '1rem',
                  }}
                >
                  <strong>
                    Wallet setup is unavailable in synthetic demo.
                  </strong>{' '}
                  This demo cannot contact Wallet and visibly labels every
                  record as synthetic. Clear the session to start a live
                  workflow.
                </div>
              )}
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#69736c',
                  margin: '0 0 1rem',
                }}
              >
                Approved transactions will be sent to Wallet REST at
                https://rest.budgetbakers.com/wallet. This is an external
                network action; no data is sent until you explicitly confirm the
                dry-run snapshot. Token is kept only in server session memory
                and never shown again.
              </p>
              {walletError && (
                <div
                  role="alert"
                  style={{
                    background: '#fdecea',
                    border: '1px solid #f5c2c0',
                    padding: '0.75rem 1rem',
                    borderRadius: 8,
                    marginBottom: '1rem',
                  }}
                >
                  <strong>Error [{walletError.code}]</strong>:{' '}
                  {walletError.message}
                </div>
              )}
              <div
                role="status"
                aria-live="polite"
                style={{ position: 'absolute', left: '-10000px' }}
              >
                {walletSetupStatus === 'pending' && 'Wallet loading'}
                {walletSetupStatus === 'success' && 'Wallet ready'}
              </div>

              {/* Token connect */}
              <div
                style={{
                  display: 'grid',
                  gap: '0.75rem',
                  maxWidth: '32rem',
                  marginBottom: '1rem',
                }}
              >
                <label
                  htmlFor="wallet-token"
                  style={{ fontWeight: 600, fontSize: '0.9rem' }}
                >
                  Wallet API token (password field, not stored beyond session)
                </label>
                <input
                  id="wallet-token"
                  type="password"
                  value={walletToken}
                  onChange={(e) => setWalletToken(e.target.value)}
                  disabled={isDemo}
                  placeholder="Paste Wallet Bearer token"
                  autoComplete="off"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 8,
                    border: '1px solid #c3cec5',
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={handleWalletConnect}
                    disabled={
                      isDemo ||
                      !walletToken.trim() ||
                      walletSetupStatus === 'pending'
                    }
                    style={{
                      padding: '0.6rem 1.2rem',
                      borderRadius: 8,
                      background: '#285c42',
                      color: 'white',
                      border: 'none',
                      fontWeight: 600,
                    }}
                  >
                    Connect & load Wallet data
                  </button>
                  <button
                    type="button"
                    onClick={refreshWalletSetup}
                    disabled={isDemo}
                    style={{
                      padding: '0.6rem 1rem',
                      borderRadius: 8,
                      background: 'white',
                      border: '1px solid #c3cec5',
                    }}
                  >
                    Refresh setup
                  </button>
                  {walletSetup && (
                    <button
                      type="button"
                      onClick={handleWalletDisconnect}
                      style={{
                        padding: '0.6rem 1rem',
                        borderRadius: 8,
                        background: 'white',
                        border: '1px solid #b42318',
                        color: '#b42318',
                      }}
                    >
                      Disconnect (retain journal)
                    </button>
                  )}
                </div>
                {walletSetup && (
                  <div style={{ fontSize: '0.85rem', color: '#69736c' }}>
                    State: <strong>{walletSetup.connectionState}</strong>
                    {walletSetup.connectionState === 'rate_limited' &&
                      walletSetup.journal && (
                        <span>
                          {' '}
                          — throttled, wait before retry. Use bounded wait.
                        </span>
                      )}
                    {walletSetup.connectionState === 'initial_sync_pending' && (
                      <span>
                        {' '}
                        — Wallet initial sync pending; no further write until
                        ready.
                      </span>
                    )}
                    {walletSetup.catalogVersion && (
                      <span>
                        {' '}
                        — catalog {walletSetup.catalogVersion} (
                        {walletSetup.accounts.length} accounts,{' '}
                        {walletSetup.categories.length} categories)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Account selection */}
              {walletSetup && walletSetup.accounts.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <label
                    htmlFor="wallet-account"
                    style={{ fontWeight: 600, fontSize: '0.9rem' }}
                  >
                    Destination account (exactly one writable account)
                  </label>
                  <select
                    id="wallet-account"
                    value={selectedWalletAccount}
                    onChange={(e) => setSelectedWalletAccount(e.target.value)}
                    style={{
                      display: 'block',
                      marginTop: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 8,
                      border: '1px solid #c3cec5',
                      minWidth: '20rem',
                    }}
                  >
                    <option value="">— select writable account —</option>
                    {walletSetup.accounts.map((a) => (
                      <option
                        key={a.walletAccountId}
                        value={a.walletAccountId}
                        disabled={!a.writable}
                      >
                        {a.walletAccountLabel} ({a.currency}){' '}
                        {a.writable ? '✓ writable' : '✗ not writable'}
                      </option>
                    ))}
                  </select>
                  {walletSetup.accounts.filter((a) => a.writable).length ===
                    0 && (
                    <p style={{ color: '#b42318', fontSize: '0.85rem' }}>
                      Zero writable accounts — cannot commit.
                    </p>
                  )}
                </div>
              )}

              {/* Category mapping */}
              {walletSetup &&
                walletSetup.accounts.length > 0 &&
                reviewItems && (
                  <div
                    style={{
                      marginBottom: '1rem',
                      overflowX: 'auto',
                      background: 'white',
                      border: '1px solid #d4dbd4',
                      borderRadius: 8,
                      padding: '1rem',
                    }}
                  >
                    <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                      Map every approved local category to a Wallet category
                    </h3>
                    <p style={{ fontSize: '0.85rem', color: '#69736c' }}>
                      Exact-name matching is only a suggestion; server validates
                      your explicit choice.
                    </p>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.88rem',
                        marginTop: '0.5rem',
                      }}
                    >
                      <thead>
                        <tr
                          style={{ background: '#eef2eb', textAlign: 'left' }}
                        >
                          <th style={{ padding: '0.5rem' }}>Local category</th>
                          <th style={{ padding: '0.5rem' }}>Wallet category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from(
                          new Set(
                            reviewItems
                              .filter((i) => i.reviewState === 'approved')
                              .map((i) => i.categoryName)
                              .filter(Boolean) as string[],
                          ),
                        ).map((localCat) => {
                          const suggested = walletSetup.categories.find(
                            (c) =>
                              c.walletCategoryLabel.toLowerCase().trim() ===
                                localCat.toLowerCase().trim() && !c.isGroup,
                          );
                          return (
                            <tr
                              key={localCat}
                              style={{ borderTop: '1px solid #e4e9e3' }}
                            >
                              <td style={{ padding: '0.5rem' }}>{localCat}</td>
                              <td style={{ padding: '0.5rem' }}>
                                <select
                                  value={walletMappings[localCat] ?? ''}
                                  onChange={(e) =>
                                    setWalletMappings((prev) => ({
                                      ...prev,
                                      [localCat]: e.target.value,
                                    }))
                                  }
                                  aria-label={`Map ${localCat} to Wallet category`}
                                  style={{
                                    padding: '0.4rem',
                                    borderRadius: 6,
                                    border: '1px solid #c3cec5',
                                    minWidth: '16rem',
                                  }}
                                >
                                  <option value="">— select —</option>
                                  {walletSetup.categories
                                    .filter((c) => !c.isGroup)
                                    .map((c) => (
                                      <option
                                        key={c.walletCategoryId}
                                        value={c.walletCategoryId}
                                      >
                                        {c.walletCategoryLabel}
                                        {suggested &&
                                        suggested.walletCategoryId ===
                                          c.walletCategoryId
                                          ? ' (suggested)'
                                          : ''}
                                      </option>
                                    ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <button
                      type="button"
                      onClick={handleWalletSelection}
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.6rem 1.2rem',
                        borderRadius: 8,
                        background: '#285c42',
                        color: 'white',
                        border: 'none',
                        fontWeight: 600,
                      }}
                    >
                      Save selection & mappings
                    </button>
                  </div>
                )}

              {/* Dry-run */}
              <div
                style={{
                  marginBottom: '1rem',
                  display: 'flex',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={handleWalletDryRun}
                  disabled={walletSetupStatus === 'pending'}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: 8,
                    background: '#285c42',
                    color: 'white',
                    border: 'none',
                    fontWeight: 600,
                  }}
                >
                  Create dry-run
                </button>
                {walletDryRun && (
                  <span
                    style={{
                      fontSize: '0.85rem',
                      color: '#69736c',
                      alignSelf: 'center',
                    }}
                  >
                    Dry-run {walletDryRun.snapshotId.slice(0, 8)} —{' '}
                    {walletDryRun.count} records, total{' '}
                    {(walletDryRun.totalMinor / 100).toLocaleString('en-PH', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    to {walletDryRun.accountLabel} —{' '}
                    <strong>Not sent yet</strong>
                  </span>
                )}
              </div>

              {walletDryRun && (
                <div
                  style={{
                    marginBottom: '1rem',
                    background: 'white',
                    border: '1px solid #d4dbd4',
                    borderRadius: 8,
                    padding: '1rem',
                    overflowX: 'auto',
                  }}
                >
                  <h4 style={{ margin: '0 0 0.5rem' }}>
                    Dry-run preview — exact records to be sent
                  </h4>
                  <p style={{ fontSize: '0.85rem', color: '#69736c' }}>
                    Count: {walletDryRun.count} — Total: PHP{' '}
                    {(walletDryRun.totalMinor / 100).toLocaleString('en-PH', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    — Destination: {walletDryRun.accountLabel} — Coverage:{' '}
                    {walletDryRun.coverage.mappedCount}/
                    {walletDryRun.coverage.localCategoryCount} mapped — Not sent
                    yet
                  </p>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '0.85rem',
                      marginTop: '0.5rem',
                    }}
                  >
                    <thead>
                      <tr style={{ background: '#eef2eb', textAlign: 'left' }}>
                        <th style={{ padding: '0.4rem' }}>Date</th>
                        <th style={{ padding: '0.4rem' }}>Description</th>
                        <th style={{ padding: '0.4rem' }}>Amount</th>
                        <th style={{ padding: '0.4rem' }}>Category → Wallet</th>
                        <th style={{ padding: '0.4rem' }}>Split lineage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {walletDryRun.items.map((it) => (
                        <tr
                          key={it.reviewItemId}
                          style={{ borderTop: '1px solid #e4e9e3' }}
                        >
                          <td style={{ padding: '0.4rem' }}>{it.date}</td>
                          <td style={{ padding: '0.4rem' }}>
                            {it.description}
                          </td>
                          <td
                            style={{
                              padding: '0.4rem',
                              color: it.amountMinor < 0 ? '#b42318' : 'inherit',
                            }}
                          >
                            {(it.amountMinor / 100).toFixed(2)}
                          </td>
                          <td style={{ padding: '0.4rem' }}>
                            {it.categoryName} → {it.walletCategoryLabel}
                          </td>
                          <td style={{ padding: '0.4rem' }}>
                            {it.splitParentReviewItemId
                              ? `child of ${it.splitParentReviewItemId.slice(0, 8)}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    ref={walletConfirmTriggerRef}
                    type="button"
                    onClick={() => setShowWalletConfirm(true)}
                    disabled={walletCommitPending}
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.6rem 1.2rem',
                      borderRadius: 8,
                      background: '#b42318',
                      color: 'white',
                      border: 'none',
                      fontWeight: 600,
                    }}
                  >
                    Confirm & commit (irreversible)
                  </button>
                </div>
              )}

              {showWalletConfirm && walletDryRun && (
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="wallet-confirm-title"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && !walletCommitPending) {
                      setShowWalletConfirm(false);
                      queueMicrotask(() =>
                        walletConfirmTriggerRef.current?.focus(),
                      );
                    }
                  }}
                  style={{
                    background: '#fff',
                    border: '2px solid #b42318',
                    borderRadius: 8,
                    padding: '1rem',
                    marginBottom: '1rem',
                  }}
                >
                  <h4
                    id="wallet-confirm-title"
                    style={{ margin: '0 0 0.5rem' }}
                  >
                    Confirm commit
                  </h4>
                  <p style={{ fontSize: '0.9rem' }}>
                    Destination: <strong>{walletDryRun.accountLabel}</strong> —
                    Records: <strong>{walletDryRun.count}</strong> — Signed
                    total:{' '}
                    <strong>
                      PHP{' '}
                      {(walletDryRun.totalMinor / 100).toLocaleString('en-PH', {
                        minimumFractionDigits: 2,
                      })}
                    </strong>
                    . This will send data to Wallet and cannot be undone. Wallet
                    may show delay before visibility. Continue?
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      marginTop: '0.5rem',
                    }}
                  >
                    <button
                      ref={walletConfirmButtonRef}
                      type="button"
                      onClick={handleWalletCommit}
                      disabled={walletCommitPending}
                      style={{
                        padding: '0.6rem 1rem',
                        borderRadius: 6,
                        background: walletCommitPending ? '#ccc' : '#b42318',
                        color: 'white',
                        border: 'none',
                        fontWeight: 600,
                      }}
                    >
                      {walletCommitPending ? 'Committing…' : 'Yes, commit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowWalletConfirm(false);
                        queueMicrotask(() =>
                          walletConfirmTriggerRef.current?.focus(),
                        );
                      }}
                      style={{
                        padding: '0.6rem 1rem',
                        borderRadius: 6,
                        background: 'white',
                        border: '1px solid #c3cec5',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {walletThrottleWaitMs !== null && (
                    <p
                      style={{
                        fontSize: '0.85rem',
                        color: '#b42318',
                        marginTop: '0.5rem',
                      }}
                    >
                      Rate limited. Wait{' '}
                      {Math.ceil(walletThrottleWaitMs / 1000)}s — bounded
                      cancellable wait.{' '}
                      <button
                        type="button"
                        onClick={() => setWalletThrottleWaitMs(null)}
                        style={{
                          marginLeft: '0.5rem',
                          padding: '0.3rem 0.6rem',
                          borderRadius: 4,
                          border: '1px solid #c3cec5',
                          background: 'white',
                        }}
                      >
                        Cancel wait
                      </button>
                    </p>
                  )}
                </div>
              )}

              {/* Results */}
              {walletResults && (
                <div
                  style={{
                    marginBottom: '1rem',
                    background: 'white',
                    border: '1px solid #d4dbd4',
                    borderRadius: 8,
                    padding: '1rem',
                  }}
                >
                  <h4 style={{ margin: '0 0 0.5rem' }}>Commit results</h4>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '1rem',
                      fontSize: '0.9rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <span>
                      <strong>Total:</strong> {walletResults.summary.total}
                    </span>
                    <span style={{ color: '#0a7a0a' }}>
                      <strong>Succeeded:</strong>{' '}
                      {walletResults.summary.succeeded}
                    </span>
                    <span style={{ color: '#b42318' }}>
                      <strong>Client error:</strong>{' '}
                      {walletResults.summary.clientError}
                    </span>
                    <span style={{ color: '#b45309' }}>
                      <strong>Retryable:</strong>{' '}
                      {walletResults.summary.serverRetry}
                    </span>
                    <span style={{ color: '#6b7280' }}>
                      <strong>Unknown:</strong> {walletResults.summary.unknown}
                    </span>
                    <span>
                      <strong>Not submitted:</strong>{' '}
                      {walletResults.summary.notSubmitted}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#69736c' }}>
                    Wallet IDs appear only for confirmed successes. Unknown
                    outcomes require manual resolution; no resend control for
                    unknowns.
                  </p>
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '0.85rem',
                      }}
                    >
                      <thead>
                        <tr
                          style={{ background: '#eef2eb', textAlign: 'left' }}
                        >
                          <th style={{ padding: '0.4rem' }}>Source</th>
                          <th style={{ padding: '0.4rem' }}>Status</th>
                          <th style={{ padding: '0.4rem' }}>Wallet ID</th>
                          <th style={{ padding: '0.4rem' }}>Error code</th>
                          <th style={{ padding: '0.4rem' }}>Attempts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walletResults.journal.map((j) => (
                          <tr
                            key={j.reviewItemId}
                            style={{
                              borderTop: '1px solid #e4e9e3',
                              background:
                                j.status === 'succeeded'
                                  ? '#eef6ee'
                                  : j.status === 'server_error_retryable'
                                    ? '#fff8e6'
                                    : 'transparent',
                            }}
                          >
                            <td style={{ padding: '0.4rem' }}>
                              {j.sourceRowId}
                            </td>
                            <td
                              style={{ padding: '0.4rem' }}
                              aria-label={`status ${j.status}`}
                            >
                              {j.status}
                            </td>
                            <td style={{ padding: '0.4rem' }}>
                              {j.walletRecordId ?? '—'}
                            </td>
                            <td style={{ padding: '0.4rem' }}>
                              {j.safeErrorCode ?? '—'}
                            </td>
                            <td style={{ padding: '0.4rem' }}>
                              {j.attemptCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div
                    style={{
                      marginTop: '0.75rem',
                      display: 'flex',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      type="button"
                      onClick={handleWalletRetry}
                      disabled={
                        walletRetryPending ||
                        walletResults.summary.serverRetry === 0
                      }
                      style={{
                        padding: '0.6rem 1rem',
                        borderRadius: 8,
                        background:
                          walletResults.summary.serverRetry === 0
                            ? '#ccc'
                            : '#285c42',
                        color: 'white',
                        border: 'none',
                        fontWeight: 600,
                      }}
                    >
                      {walletRetryPending
                        ? 'Retrying…'
                        : `Retry server errors (${walletResults.summary.serverRetry})`}
                    </button>
                    <button
                      type="button"
                      onClick={handleWalletExport}
                      style={{
                        padding: '0.6rem 1rem',
                        borderRadius: 8,
                        background: 'white',
                        border: '1px solid #285c42',
                        color: '#285c42',
                      }}
                    >
                      Download redacted summary
                    </button>
                  </div>
                  <p
                    style={{
                      fontSize: '0.85rem',
                      color: '#69736c',
                      marginTop: '0.5rem',
                    }}
                  >
                    Sync delay: Wallet may not show records immediately; never
                    promise immediate visibility. Export excludes token,
                    descriptions, payees, notes, references, raw bodies, and
                    labels.
                  </p>
                </div>
              )}

              <div
                aria-live="polite"
                style={{ fontSize: '0.85rem', color: '#69736c' }}
              >
                Journal is active-session only; clear session removes it.
                Default export is redacted.
              </div>
            </section>
          )}

          {/* Diagnostics — optional, explicit, previewable, local-only, redacted */}
          {result && (
            <section
              aria-labelledby="diagnostics-title"
              style={{
                marginTop: '1.5rem',
                background: '#fcfdf9',
                border: '1px solid #d4dbd4',
                borderRadius: '1rem',
                padding: '1.5rem',
              }}
            >
              <h2
                id="diagnostics-title"
                style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}
              >
                Optional diagnostics (redacted, local download)
              </h2>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: '#69736c',
                  margin: '0 0 1rem',
                }}
              >
                Generates a redacted bundle locally — no upload, no auto-attach.
                Includes only app/Node/OS-family versions, feature flags,
                non-sensitive limits, parser/provider IDs (not endpoints),
                pipeline stage, safe issue codes, bounded counts/timing buckets,
                and Wallet status counts. Excludes all document/history bytes,
                transaction fields, descriptions, dates, amounts, notes,
                categories, prompts, tokens, paths, and Wallet IDs.{' '}
                <strong>Preview before downloading.</strong>
              </p>
              {diagnosticsError && (
                <div
                  role="alert"
                  style={{
                    background: '#fdecea',
                    border: '1px solid #f5c2c0',
                    padding: '0.6rem 0.8rem',
                    borderRadius: 8,
                    marginBottom: '0.75rem',
                  }}
                >
                  <strong>Error [{diagnosticsError.code}]</strong>:{' '}
                  {diagnosticsError.message}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                  marginBottom: '0.75rem',
                }}
              >
                <button
                  type="button"
                  onClick={handlePreviewDiagnostics}
                  disabled={diagnosticsPending}
                  aria-label="Preview diagnostics bundle"
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: 8,
                    border: '1px solid #285c42',
                    background: 'white',
                    color: '#285c42',
                    fontWeight: 600,
                  }}
                >
                  {diagnosticsPending ? 'Loading…' : 'Preview diagnostics'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadDiagnostics}
                  disabled={!diagnosticsPreview}
                  aria-label="Download diagnostics bundle"
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: 8,
                    border: '1px solid #285c42',
                    background: diagnosticsPreview ? '#285c42' : 'white',
                    color: diagnosticsPreview ? 'white' : '#285c42',
                    fontWeight: 600,
                    opacity: !diagnosticsPreview ? 0.6 : 1,
                  }}
                >
                  Download diagnostics.json
                </button>
                {diagnosticsPreview && (
                  <button
                    type="button"
                    onClick={() => setDiagnosticsPreview(null)}
                    style={{
                      padding: '0.6rem 1rem',
                      borderRadius: 8,
                      border: '1px solid #c3cec5',
                      background: 'white',
                    }}
                  >
                    Clear preview
                  </button>
                )}
              </div>
              {diagnosticsPreview && (
                <pre
                  aria-label="Diagnostics preview"
                  style={{
                    background: 'white',
                    border: '1px solid #e4e9e3',
                    borderRadius: 8,
                    padding: '0.75rem',
                    fontSize: '0.8rem',
                    maxHeight: '20rem',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(
                    diagnosticsPreview as unknown as Record<string, unknown>,
                    null,
                    2,
                  )}
                </pre>
              )}
              <p
                style={{
                  fontSize: '0.8rem',
                  color: '#69736c',
                  marginTop: '0.5rem',
                }}
              >
                Never automatically attached or uploaded. Delete the file after
                use if no longer needed.
              </p>
            </section>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem' }}>
            {!showClearConfirm ? (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                style={{
                  padding: '0.6rem 1.2rem',
                  borderRadius: 8,
                  border: '1px solid #b42318',
                  background: 'white',
                  color: '#b42318',
                  fontWeight: 600,
                }}
              >
                Clear session
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  alignItems: 'center',
                  background: '#fff',
                  border: '1px solid #f5c2c0',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: '0.9rem' }}>
                  Clear and remove all results and Phase 2 data?
                </span>
                <button
                  type="button"
                  onClick={onClear}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: 6,
                    background: '#b42318',
                    color: 'white',
                    border: 'none',
                  }}
                >
                  Confirm clear
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(false)}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: 6,
                    background: 'white',
                    border: '1px solid #c3cec5',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
