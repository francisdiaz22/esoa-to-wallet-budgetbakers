import { randomUUID } from 'node:crypto';
import type { ExtractionResult } from './contracts.js';
import { TemporaryWorkspace } from './workspace.js';
import type {
  WalletHistoryRecord,
  CategoryCatalogEntry,
  CategoryProposal,
  ProviderConfig,
  ProviderConfigSafe,
  HistoryImportSummary,
  CategorizationResult,
} from '../categorization/contracts.js';
import type { ReviewItem, ReviewAuditEvent } from '../review/contracts.js';
import type {
  WalletConnectionState,
  WalletAccountSafe,
  WalletCategorySafe,
  WalletCategoryMapping,
  WalletSnapshot,
  WalletRecordCreate,
  CommitJournalEntry,
  WalletAuditEvent as WalletAuditEventType,
} from '../wallet/contracts.js';

type Phase2State = {
  historyRecords: WalletHistoryRecord[];
  catalog: CategoryCatalogEntry[];
  historyVersion: number;
  importSummary: HistoryImportSummary;
  providerConfig?: ProviderConfig;
  providerConfigSafe?: ProviderConfigSafe;
  proposals?: CategoryProposal[];
  categorizationResult?: CategorizationResult;
  // used for atomic stale detection
  pendingCategorizationVersion?: number;
};

type Phase3State = {
  reviewItems: ReviewItem[];
  reviewVersion: number;
  historyVersion: number;
  auditEvents: ReviewAuditEvent[];
  // For pending targeted reclassification
  pendingRecategorizeSourceRowId?: string;
  pendingRecategorizeRevision?: number;
};

export type Phase4State = {
  // Private token — never exposed via generic getters, never returned/logged/stored in browser/.env
  token?: string;
  tokenGeneration?: string;
  connectionState: WalletConnectionState;
  // Safe connection metadata (bounded)
  connectionMeta?: {
    catalogVersion?: string;
    accountCount?: number;
    categoryCount?: number;
    retryAfterMs?: number;
    retryAfterAt?: string;
    initialSyncRetryMinutes?: number;
  };
  catalog?: {
    accounts: WalletAccountSafe[];
    categories: WalletCategorySafe[];
    version: string;
    fetchedAt: string;
  };
  selection?: {
    walletAccountId: string;
    walletAccountLabel: string;
    mappings: WalletCategoryMapping[];
  };
  snapshot?: WalletSnapshot;
  // Private immutable payloads for same-session recovery. Never exposed by routes.
  recoverySnapshots: Record<
    string,
    {
      createdAt: string;
      payloads: Record<string, WalletRecordCreate>;
    }
  >;
  journal: CommitJournalEntry[];
  auditEvents: WalletAuditEventType[];
  commitLock: boolean;
  rateLimitedUntil?: string;
};

type SessionEntry = {
  result: ExtractionResult;
  workspace: TemporaryWorkspace;
  createdAt: number;
  phase2?: Phase2State;
  phase3?: Phase3State;
  phase4?: Phase4State;
};

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();

  /** Create a new session with opaque random ID; stores result + workspace */
  create(
    result: Omit<ExtractionResult, 'sessionId'>,
    workspace: TemporaryWorkspace,
  ): ExtractionResult {
    const sessionId = randomUUID();
    const full: ExtractionResult = {
      ...result,
      sessionId,
      summary: result.summary,
    };
    // Patch sessionId inside result to match
    const entry: SessionEntry = {
      result: full,
      workspace,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, entry);
    // Also update workspace sessionId? workspace already created with that id; but we created workspace earlier with randomUUID? So we need to align.
    // Instead caller should create workspace with same sessionId. We enforce:
    if (workspace.sessionId !== sessionId) {
      // If workspace id mismatches, we treat as error and cleanup
      // To avoid complexity, generate id first externally.
      throw new Error('session/workspace id mismatch');
    }
    return full;
  }

  /** Alternative: create with pre-generated id (preferred) */
  createWithId(
    sessionId: string,
    result: Omit<ExtractionResult, 'sessionId'>,
    workspace: TemporaryWorkspace,
  ): ExtractionResult {
    if (workspace.sessionId !== sessionId)
      throw new Error('session/workspace id mismatch');
    const full: ExtractionResult = { ...result, sessionId };
    this.sessions.set(sessionId, {
      result: full,
      workspace,
      createdAt: Date.now(),
    });
    return full;
  }

  get(sessionId: string): ExtractionResult | null {
    return this.sessions.get(sessionId)?.result ?? null;
  }

  getEntry(sessionId: string): SessionEntry | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getPhase2(sessionId: string): Phase2State | null {
    return this.sessions.get(sessionId)?.phase2 ?? null;
  }

  /** Set history atomically; validates already done before calling. Invalidates proposals and review. */
  setHistory(
    sessionId: string,
    records: WalletHistoryRecord[],
    catalog: CategoryCatalogEntry[],
    summary: HistoryImportSummary,
  ): HistoryImportSummary | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    const nextVersion = (entry.phase2?.historyVersion ?? 0) + 1;
    const updatedSummary: HistoryImportSummary = {
      ...summary,
      historyVersion: nextVersion,
    };
    const nextPhase2: Phase2State = {
      historyRecords: records,
      catalog,
      historyVersion: nextVersion,
      importSummary: updatedSummary,
      providerConfig: entry.phase2?.providerConfig,
      providerConfigSafe: entry.phase2?.providerConfigSafe,
      // invalidate proposals atomically
      proposals: undefined,
      categorizationResult: undefined,
    };
    entry.phase2 = nextPhase2;
    // Invalidate review atomically — category authority changed
    entry.phase3 = undefined;
    // Invalidate wallet selections/mapping/snapshot — keep journal but clear pending snapshot
    if (entry.phase4) {
      entry.phase4.catalog = undefined;
      entry.phase4.selection = undefined;
      entry.phase4.snapshot = undefined;
      // retain journal but mark pending snapshots invalidated; journal entries keep status
      // Invalidate incompatible mappings handled via selection clear above
    }
    return updatedSummary;
  }

  getHistoryRecords(sessionId: string): WalletHistoryRecord[] | null {
    return this.sessions.get(sessionId)?.phase2?.historyRecords ?? null;
  }

  getCatalog(sessionId: string): CategoryCatalogEntry[] | null {
    return this.sessions.get(sessionId)?.phase2?.catalog ?? null;
  }

  getHistorySummary(sessionId: string): HistoryImportSummary | null {
    return this.sessions.get(sessionId)?.phase2?.importSummary ?? null;
  }

  getHistoryVersion(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.phase2?.historyVersion ?? null;
  }

  setProviderConfig(
    sessionId: string,
    config: ProviderConfig,
    safe: ProviderConfigSafe,
  ): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    // ensure phase2 exists even without history — provider config is allowed before history per spec? but categorization requires both
    if (!entry.phase2) {
      entry.phase2 = {
        historyRecords: [],
        catalog: [],
        historyVersion: 0,
        importSummary: {
          recordCount: 0,
          categoryCount: 0,
          accountCount: 0,
          adapterId: 'none',
          adapterVersion: '0.0.0',
          historyVersion: 0,
        },
        providerConfig: config,
        providerConfigSafe: safe,
      };
    } else {
      entry.phase2.providerConfig = config;
      entry.phase2.providerConfigSafe = safe;
    }
    return true;
  }

  getProviderConfig(sessionId: string): ProviderConfig | null {
    return this.sessions.get(sessionId)?.phase2?.providerConfig ?? null;
  }

  getProviderConfigSafe(sessionId: string): ProviderConfigSafe | null {
    return this.sessions.get(sessionId)?.phase2?.providerConfigSafe ?? null;
  }

  setProposals(
    sessionId: string,
    proposals: CategoryProposal[],
    result: CategorizationResult,
    expectedHistoryVersion: number,
  ): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.phase2) return false;
    if (entry.phase2.historyVersion !== expectedHistoryVersion) {
      // stale
      return false;
    }
    entry.phase2.proposals = proposals;
    entry.phase2.categorizationResult = result;
    entry.phase2.pendingCategorizationVersion = undefined;
    // Invalidate review — full recategorization replaces all proposals, so rebuild required
    entry.phase3 = undefined;
    // Also invalidate wallet snapshot (review changed)
    if (entry.phase4) {
      entry.phase4.snapshot = undefined;
    }
    return true;
  }

  getProposals(sessionId: string): CategoryProposal[] | null {
    return this.sessions.get(sessionId)?.phase2?.proposals ?? null;
  }

  getCategorizationResult(sessionId: string): CategorizationResult | null {
    return this.sessions.get(sessionId)?.phase2?.categorizationResult ?? null;
  }

  setPendingCategorization(sessionId: string, historyVersion: number): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry || !entry.phase2) return false;
    if (entry.phase2.historyVersion !== historyVersion) return false;
    entry.phase2.pendingCategorizationVersion = historyVersion;
    return true;
  }

  clearPendingCategorization(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.phase2) entry.phase2.pendingCategorizationVersion = undefined;
  }

  isPendingCategorization(sessionId: string): boolean {
    return !!this.sessions.get(sessionId)?.phase2?.pendingCategorizationVersion;
  }

  // Phase 3 — Review
  getReview(sessionId: string): Phase3State | null {
    return this.sessions.get(sessionId)?.phase3 ?? null;
  }

  getReviewItems(sessionId: string): ReviewItem[] | null {
    return this.sessions.get(sessionId)?.phase3?.reviewItems ?? null;
  }

  getReviewVersion(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.phase3?.reviewVersion ?? null;
  }

  getAuditEvents(sessionId: string): ReviewAuditEvent[] | null {
    return this.sessions.get(sessionId)?.phase3?.auditEvents ?? null;
  }

  setReview(sessionId: string, state: Phase3State): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    entry.phase3 = state;
    return true;
  }

  clearReview(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.phase3) entry.phase3 = undefined;
  }

  updateReviewItem(sessionId: string, updated: ReviewItem): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.phase3) return false;
    const idx = entry.phase3.reviewItems.findIndex(
      (i) => i.reviewItemId === updated.reviewItemId,
    );
    if (idx === -1) return false;
    entry.phase3.reviewItems[idx] = updated;
    entry.phase3.reviewVersion += 1;
    return true;
  }

  replaceReviewItems(sessionId: string, items: ReviewItem[]): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.phase3) return false;
    entry.phase3.reviewItems = items;
    entry.phase3.reviewVersion += 1;
    return true;
  }

  appendAuditEvent(sessionId: string, event: ReviewAuditEvent): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.phase3) return false;
    if (entry.phase3.auditEvents.length >= 500) return false; // LIMITS.MAX_AUDIT_EVENTS
    entry.phase3.auditEvents.push(event);
    return true;
  }

  setPendingRecategorize(
    sessionId: string,
    sourceRowId: string,
    revision: number,
  ): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.phase3) return false;
    entry.phase3.pendingRecategorizeSourceRowId = sourceRowId;
    entry.phase3.pendingRecategorizeRevision = revision;
    return true;
  }

  clearPendingRecategorize(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.phase3) {
      entry.phase3.pendingRecategorizeSourceRowId = undefined;
      entry.phase3.pendingRecategorizeRevision = undefined;
    }
  }

  isPendingRecategorize(sessionId: string): boolean {
    return !!this.sessions.get(sessionId)?.phase3
      ?.pendingRecategorizeSourceRowId;
  }

  // Phase 4 — Wallet

  ensurePhase4(sessionId: string): Phase4State | null {
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    if (!entry.phase4) {
      entry.phase4 = {
        connectionState: 'not_configured',
        recoverySnapshots: {},
        journal: [],
        auditEvents: [],
        commitLock: false,
      };
    }
    return entry.phase4;
  }

  getPhase4(sessionId: string): Phase4State | null {
    return this.sessions.get(sessionId)?.phase4 ?? null;
  }

  // Private token — only via explicit methods, never via generic getter
  setWalletToken(sessionId: string, token: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    phase4.token = token;
    phase4.tokenGeneration = randomUUID();
    // Token replacement invalidates incompatible mappings and every snapshot
    phase4.selection = undefined;
    phase4.snapshot = undefined;
    // Clear catalog? per spec catalog refresh/token replacement invalidates incompatible mappings and every snapshot
    // Keep catalog but selection cleared; snapshot cleared above
    phase4.connectionState = 'not_configured'; // will become ready after successful fetch
    return true;
  }

  getWalletToken(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.phase4?.token ?? null;
  }

  getWalletTokenGeneration(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.phase4?.tokenGeneration ?? null;
  }

  clearWalletToken(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.phase4) return;
    entry.phase4.token = undefined;
    entry.phase4.tokenGeneration = undefined;
    entry.phase4.connectionState = 'not_configured';
    entry.phase4.catalog = undefined;
    entry.phase4.selection = undefined;
    entry.phase4.snapshot = undefined;
    // retain journal per disconnect spec: erase token/setup; retain journal
  }

  setWalletConnectionState(
    sessionId: string,
    state: WalletConnectionState,
    meta?: Phase4State['connectionMeta'],
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    phase4.connectionState = state;
    if (meta) phase4.connectionMeta = meta;
    return true;
  }

  getWalletConnectionSafe(sessionId: string): {
    state: WalletConnectionState;
    meta?: Phase4State['connectionMeta'];
  } | null {
    const phase4 = this.sessions.get(sessionId)?.phase4;
    if (!phase4) return null;
    return { state: phase4.connectionState, meta: phase4.connectionMeta };
  }

  setWalletCatalog(
    sessionId: string,
    accounts: WalletAccountSafe[],
    categories: WalletCategorySafe[],
    version: string,
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    phase4.catalog = {
      accounts,
      categories,
      version,
      fetchedAt: new Date().toISOString(),
    };
    phase4.connectionState = 'ready';
    phase4.connectionMeta = {
      catalogVersion: version,
      accountCount: accounts.length,
      categoryCount: categories.length,
    };
    // Catalog refresh invalidates incompatible mappings and every snapshot
    // Invalidate mappings that refer to categories no longer present
    if (phase4.selection) {
      const validCatIds = new Set(categories.map((c) => c.walletCategoryId));
      const hasInvalid = phase4.selection.mappings.some(
        (m) => !validCatIds.has(m.walletCategoryId),
      );
      if (hasInvalid) {
        phase4.selection = undefined;
      } else {
        // Also ensure catalogVersion matches; if not, keep but map to new catalogVersion?
        // Update mappings catalogVersion to new version if still valid? For simplicity invalidate snapshot only
      }
    }
    phase4.snapshot = undefined;
    return true;
  }

  getWalletCatalog(sessionId: string): {
    accounts: WalletAccountSafe[];
    categories: WalletCategorySafe[];
    version: string;
    fetchedAt: string;
  } | null {
    return this.sessions.get(sessionId)?.phase4?.catalog ?? null;
  }

  setWalletSelection(
    sessionId: string,
    walletAccountId: string,
    walletAccountLabel: string,
    mappings: WalletCategoryMapping[],
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    phase4.selection = { walletAccountId, walletAccountLabel, mappings };
    phase4.snapshot = undefined; // any selection change invalidates snapshot
    return true;
  }

  getWalletSelection(sessionId: string): Phase4State['selection'] | null {
    return this.sessions.get(sessionId)?.phase4?.selection ?? null;
  }

  setWalletSnapshot(sessionId: string, snapshot: WalletSnapshot): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    phase4.snapshot = snapshot;
    return true;
  }

  getWalletSnapshot(sessionId: string): WalletSnapshot | null {
    return this.sessions.get(sessionId)?.phase4?.snapshot ?? null;
  }

  clearWalletSnapshot(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry?.phase4) entry.phase4.snapshot = undefined;
  }

  retainWalletRecoverySnapshot(
    sessionId: string,
    snapshot: WalletSnapshot,
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    const existingCount = Object.values(phase4.recoverySnapshots).reduce(
      (count, retained) => count + Object.keys(retained.payloads).length,
      0,
    );
    const replacingCount = Object.keys(
      phase4.recoverySnapshots[snapshot.snapshotId]?.payloads ?? {},
    ).length;
    if (
      existingCount - replacingCount + Object.keys(snapshot.payloads).length >
      500
    ) {
      return false;
    }
    phase4.recoverySnapshots[snapshot.snapshotId] = {
      createdAt: snapshot.createdAt,
      payloads: structuredClone(snapshot.payloads),
    };
    return true;
  }

  getWalletRecoveryPayload(
    sessionId: string,
    snapshotId: string,
    reviewItemId: string,
  ): WalletRecordCreate | null {
    const payload =
      this.sessions.get(sessionId)?.phase4?.recoverySnapshots[snapshotId]
        ?.payloads[reviewItemId];
    return payload ? structuredClone(payload) : null;
  }

  invalidateWalletSnapshot(sessionId: string): void {
    this.clearWalletSnapshot(sessionId);
  }

  // Journal
  getWalletJournal(sessionId: string): CommitJournalEntry[] | null {
    return this.sessions.get(sessionId)?.phase4?.journal ?? null;
  }

  appendWalletJournalEntry(
    sessionId: string,
    entry: CommitJournalEntry,
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    if (phase4.journal.length >= 500) return false;
    phase4.journal.push(entry);
    return true;
  }

  upsertWalletJournalEntry(
    sessionId: string,
    entry: CommitJournalEntry,
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    const idx = phase4.journal.findIndex(
      (j) =>
        j.reviewItemId === entry.reviewItemId &&
        j.snapshotId === entry.snapshotId,
    );
    if (idx === -1) {
      if (phase4.journal.length >= 500) return false;
      phase4.journal.push(entry);
    } else {
      phase4.journal[idx] = entry;
    }
    return true;
  }

  replaceWalletJournal(
    sessionId: string,
    entries: CommitJournalEntry[],
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    phase4.journal = entries;
    return true;
  }

  getWalletAuditEvents(sessionId: string): WalletAuditEventType[] | null {
    return this.sessions.get(sessionId)?.phase4?.auditEvents ?? null;
  }

  appendWalletAuditEvent(
    sessionId: string,
    event: WalletAuditEventType,
  ): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    if (phase4.auditEvents.length >= 500) return false;
    phase4.auditEvents.push(event);
    return true;
  }

  // Commit lock per session
  tryAcquireWalletLock(sessionId: string): boolean {
    const phase4 = this.ensurePhase4(sessionId);
    if (!phase4) return false;
    if (phase4.commitLock) return false;
    phase4.commitLock = true;
    return true;
  }

  releaseWalletLock(sessionId: string): void {
    const phase4 = this.sessions.get(sessionId)?.phase4;
    if (phase4) phase4.commitLock = false;
  }

  isWalletLocked(sessionId: string): boolean {
    return !!this.sessions.get(sessionId)?.phase4?.commitLock;
  }

  // Notify review mutation invalidates wallet snapshot but retains journal successes
  notifyReviewChanged(sessionId: string): void {
    this.invalidateWalletSnapshot(sessionId);
  }

  // Erase Phase4 state on demand (clear/shutdown)
  clearPhase4(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.phase4 = undefined;
  }

  // Disconnect: erase token/setup; retain journal
  disconnectWallet(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry?.phase4) return false;
    // erase token/setup; retain journal
    const retainedJournal = entry.phase4.journal;
    const retainedAudit = entry.phase4.auditEvents;
    entry.phase4.token = undefined;
    entry.phase4.tokenGeneration = undefined;
    entry.phase4.catalog = undefined;
    entry.phase4.selection = undefined;
    entry.phase4.snapshot = undefined;
    entry.phase4.connectionState = 'not_configured';
    entry.phase4.connectionMeta = undefined;
    entry.phase4.commitLock = false;
    entry.phase4.journal = retainedJournal;
    entry.phase4.auditEvents = retainedAudit;
    return true;
  }

  /** Idempotent clear; returns true if existed */
  clear(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    try {
      entry.workspace.clear();
    } catch {
      console.error('[session] workspace clear failed (non-sensitive)');
    }
    this.sessions.delete(sessionId);
    return true;
  }

  /** Clear all — for shutdown */
  clearAll(): void {
    for (const [id] of this.sessions) {
      this.clear(id);
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  size(): number {
    return this.sessions.size;
  }

  /** Generate opaque ID without creating session */
  static generateId(): string {
    return randomUUID();
  }
}

export const globalSessionStore = new SessionStore();
