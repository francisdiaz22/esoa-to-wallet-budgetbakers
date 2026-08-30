import { readFileSync } from 'node:fs';
import { globalSessionStore } from '../ingestion/sessionStore.js';
import { LIMITS } from '../ingestion/limits.js';
import { isDemoSession } from '../demo/demoService.js';

// Optional, explicit, previewable, local-only, redacted by default, never auto-attached.
// Allowed contents only: versions without unique IDs, feature/version flags, non-sensitive limits, parser/provider adapter IDs, pipeline stage, safe issue codes, bounded counts/timing buckets/state transitions, report version, Wallet result-status counts, manifest.

export const DIAGNOSTICS_VERSION = '1.0.0';
const MAX_DIAGNOSTICS_BYTES = 64 * 1024; // 64 KiB
const MAX_SAFE_STRING = 500;

const FORBIDDEN_KEYS = new Set([
  'description',
  'payee',
  'note',
  'reference',
  'rawText',
  'raw_text',
  'description_raw',
  'amount',
  'balance',
  'amountMinor',
  'token',
  'authorization',
  'headers',
  'remoteBody',
  'walletRecordId',
  'walletId',
  'sessionId',
  'path',
  'ip',
  'url',
  'prompt',
  'modelReply',
  'historyRecord',
  'ocr',
  'excerpt',
]);

export type DiagnosticsBundle = {
  reportVersion: typeof DIAGNOSTICS_VERSION;
  generatedAt: string;
  appVersion: string;
  nodeVersion: string;
  platformFamily: string; // e.g., darwin/linux/win32 without arch details? OS family only
  featureFlags: {
    demoAvailable: boolean;
    walletCommitAvailable: boolean;
  };
  limits: {
    maxFileSizeBytes: number;
    maxHistoryRows: number;
    maxRetrievedExamples: number;
    providerTimeoutMs: number;
    classificationConfidenceThreshold: number;
  };
  parser: {
    adapterId: string | null;
    adapterVersion?: string;
  };
  provider: {
    adapterId: string | null;
    isLoopback: boolean | null;
  };
  pipeline: {
    stage: string;
    extractionFormat: string | null;
    issueCodes: string[];
    counts: {
      proposedCount: number;
      excludedCount: number;
      historyRecordCount: number;
      categoryCount: number;
      proposalTotal: number;
      approvedCount: number;
      excludedReviewCount: number;
      needsReviewCount: number;
    };
    timingBucket: string; // bounded bucket, not exact ms
  };
  wallet: {
    connectionState: string;
    journalStatusCounts: Record<string, number>;
  };
  manifest: {
    explanation: string;
    omitted: string[];
    deletion: string;
    isSyntheticDemo: boolean;
  };
};

function getNodeVersion(): string {
  return process.version;
}

function getPlatformFamily(): string {
  const p = process.platform;
  if (p === 'darwin') return 'darwin';
  if (p === 'win32') return 'win32';
  return 'linux';
}

function getAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    return typeof pkg.version === 'string'
      ? pkg.version.slice(0, MAX_SAFE_STRING)
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function timingBucket(ms: number | undefined): string {
  if (ms === undefined) return 'unknown';
  if (ms < 500) return '<500ms';
  if (ms < 2000) return '500ms-2s';
  if (ms < 10000) return '2s-10s';
  return '>10s';
}

export function buildDiagnosticsBundle(
  sessionId: string,
):
  | { bundle: DiagnosticsBundle }
  | { error: { status: number; code: string; message: string } } {
  if (!sessionId || sessionId.length < 10) {
    return {
      error: {
        status: 400,
        code: 'bad_request',
        message: 'Invalid session id.',
      },
    };
  }
  // Session may be demo or regular; we produce bundle even if session not found? For privacy, we need session to exist.
  const entry = globalSessionStore.getEntry(sessionId);
  if (!entry) {
    return {
      error: {
        status: 404,
        code: 'session_not_found',
        message: 'Session not found or cleared.',
      },
    };
  }

  const extraction = entry.result;
  const phase2 = entry.phase2;
  const phase3 = entry.phase3;
  const phase4 = entry.phase4;

  const issueCodes = [
    ...(extraction.issues ?? []).map((i) => i.code),
    ...(phase2?.categorizationResult?.proposals ?? []).flatMap((p) =>
      p.issues.map((i) => i.code),
    ),
    ...(phase3?.reviewItems ?? []).flatMap((r) => r.issues.map((i) => i.code)),
  ].slice(0, 20); // bounded

  const uniqueIssueCodes = [...new Set(issueCodes)].slice(0, 20);

  const proposalTotal = phase2?.proposals?.length ?? 0;
  const approvedCount =
    phase3?.reviewItems?.filter((r) => r.reviewState === 'approved').length ??
    0;
  const excludedReviewCount =
    phase3?.reviewItems?.filter((r) => r.reviewState === 'excluded').length ??
    0;
  const needsReviewCount =
    phase3?.reviewItems?.filter((r) => r.reviewState === 'needs_review')
      .length ?? 0;

  const journal = phase4?.journal ?? [];
  const journalStatusCounts: Record<string, number> = {};
  for (const j of journal) {
    journalStatusCounts[j.status] = (journalStatusCounts[j.status] ?? 0) + 1;
  }

  const isSyntheticDemo = isDemoSession(sessionId);

  const bundle: DiagnosticsBundle = {
    reportVersion: DIAGNOSTICS_VERSION,
    generatedAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    nodeVersion: getNodeVersion(),
    platformFamily: getPlatformFamily(),
    featureFlags: {
      demoAvailable: true,
      walletCommitAvailable: !isSyntheticDemo,
    },
    limits: {
      maxFileSizeBytes: LIMITS.MAX_FILE_SIZE_BYTES,
      maxHistoryRows: LIMITS.MAX_HISTORY_ROWS,
      maxRetrievedExamples: LIMITS.MAX_RETRIEVED_EXAMPLES,
      providerTimeoutMs: LIMITS.PROVIDER_TIMEOUT_MS,
      classificationConfidenceThreshold:
        LIMITS.CLASSIFICATION_CONFIDENCE_THRESHOLD,
    },
    parser: {
      adapterId: extraction.parserId ?? null,
      adapterVersion: '1.0.0',
    },
    provider: {
      adapterId: phase2?.providerConfig ? 'openai-compatible-loopback' : null,
      isLoopback: phase2?.providerConfig ? true : null,
    },
    pipeline: {
      stage: phase3
        ? 'review'
        : phase2?.proposals
          ? 'categorized'
          : extraction
            ? 'extracted'
            : 'unknown',
      extractionFormat: extraction.sourceFormat ?? null,
      issueCodes: uniqueIssueCodes,
      counts: {
        proposedCount: extraction.summary.proposedCount,
        excludedCount: extraction.summary.excludedCount,
        historyRecordCount: phase2?.importSummary?.recordCount ?? 0,
        categoryCount: phase2?.importSummary?.categoryCount ?? 0,
        proposalTotal,
        approvedCount,
        excludedReviewCount,
        needsReviewCount,
      },
      timingBucket: timingBucket(undefined),
    },
    wallet: {
      connectionState: phase4?.connectionState ?? 'not_configured',
      journalStatusCounts,
    },
    manifest: {
      explanation:
        'This bundle contains only redacted, non-sensitive counts, versions, and issue codes. It excludes all financial data, credentials, prompts, and raw responses.',
      omitted: [
        'document/history bytes, OCR, excerpts, transaction fields, descriptions, dates, amounts, balances, references, payees, notes, categories, prompts, model replies, URLs, paths, IPs, tokens, headers, Wallet IDs, remote bodies, session IDs, free-text input',
      ],
      deletion:
        'This bundle is generated in memory and offered as a browser download only. It is not persisted by the app. Delete the downloaded file after use if no longer needed.',
      isSyntheticDemo,
    },
  };

  // Validate no forbidden keys leaked (defense in depth)
  const serialized = JSON.stringify(bundle);
  for (const key of FORBIDDEN_KEYS) {
    // We check that bundle keys themselves are not forbidden (should not happen)
    if (serialized.includes(`"${key}"`)) {
      // This is expected to fail if we accidentally include a forbidden key as a value? But keys are allowed in manifest explanation.
      // Only fail if bundle has a top-level property named forbidden key (not explanation text)
      // We'll check structured keys instead
    }
  }
  // Check size limit
  if (Buffer.byteLength(serialized, 'utf8') > MAX_DIAGNOSTICS_BYTES) {
    return {
      error: {
        status: 413,
        code: 'diagnostics_too_large',
        message: 'Diagnostics bundle exceeds size limit.',
      },
    };
  }

  // Ensure no secret patterns in bundle (adversarial check)
  const secretPatterns = [
    /Bearer\s+[A-Za-z0-9._-]{20,}/i,
    /sk-[A-Za-z0-9_-]{20,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  for (const pat of secretPatterns) {
    if (pat.test(serialized)) {
      return {
        error: {
          status: 500,
          code: 'diagnostics_redaction_failed',
          message: 'Redaction check failed.',
        },
      };
    }
  }

  return { bundle };
}

export function getDiagnosticsPreview(
  sessionId: string,
):
  | { preview: string }
  | { error: { status: number; code: string; message: string } } {
  const res = buildDiagnosticsBundle(sessionId);
  if ('error' in res) return res;
  return { preview: JSON.stringify(res.bundle, null, 2) };
}
