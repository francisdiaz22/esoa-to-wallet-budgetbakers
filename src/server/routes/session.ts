import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../ingestion/limits.js';
import { globalSessionStore } from '../ingestion/sessionStore.js';
import { createIngestionService } from '../ingestion/ingestionService.js';
import { FakeOcrEngine } from '../ingestion/extractors.js';
import { generateSyntheticBdoLines } from '../ingestion/syntheticOcrFixture.js';
import {
  parseHistoryCsv,
  historyAdapterMeta,
} from '../categorization/historyAdapter.js';
import { buildCatalog } from '../categorization/catalog.js';
import { validateLoopbackUrl } from '../categorization/openAiCompatibleProvider.js';
import { OpenAiCompatibleProvider } from '../categorization/openAiCompatibleProvider.js';
import { globalClassificationService } from '../categorization/classificationService.js';
import { globalReviewService } from '../review/reviewService.js';
import {
  ReviewPatchBodySchema,
  ReviewExcludeBodySchema,
  ReviewSplitBodySchema,
  ReviewBulkApproveBodySchema,
  ReviewReclassifyBodySchema,
  ReviewRevisionBodySchema,
} from '../review/contracts.js';
import { z } from 'zod';
import { globalWalletCommitService } from '../wallet/commitService.js';
import { isDemoSession, unmarkDemoSession } from '../demo/demoService.js';
// WalletTokenSchema validated inside commitService; no direct import needed

// Unit/API tests inject deterministic OCR. Production always uses local Tesseract.
const testOcrEngine =
  process.env.NODE_ENV === 'test'
    ? new FakeOcrEngine(generateSyntheticBdoLines())
    : undefined;
const ingestionService = createIngestionService(globalSessionStore, {
  ocrEngine: testOcrEngine,
});

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_FILE_SIZE_BYTES,
    files: LIMITS.MAX_PAGE_COUNT,
    fieldNameSize: 100,
    fieldSize: 1024,
  },
  fileFilter: (_req, file, cb) => {
    // Accept all, validation happens later; reject only path-like names here via custom check later
    cb(null, true);
  },
});

function makeRequestId(): string {
  return randomUUID();
}

function toReviewListItem(item: import('../review/contracts.js').ReviewItem) {
  return {
    ...item,
    payee: undefined,
    note: undefined,
    proposal: {
      ...item.proposal,
      rationale: '',
      retrieval: [],
    },
  };
}

function errorResponse(
  res: import('express').Response,
  err: {
    status: number;
    code: string;
    message: string;
    stage?: string;
    requestId?: string;
  },
) {
  // Never include raw document contents, stack, paths
  res.status(err.status).json({
    code: err.code,
    message: err.message,
    stage: err.stage,
    requestId: err.requestId ?? makeRequestId(),
  });
}

const historyUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.MAX_HISTORY_FILE_SIZE_BYTES,
    files: 1,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024,
  },
});

router.post(
  '/import',
  upload.fields([
    { name: 'statement', maxCount: 1 },
    { name: 'statementPages', maxCount: LIMITS.MAX_PAGE_COUNT },
  ]),
  async (req, res) => {
    const requestId = makeRequestId();
    try {
      const filesMap = req.files as
        Record<string, Express.Multer.File[] | undefined> | undefined;
      const hasStatement = !!filesMap?.['statement']?.length;
      const hasPages = !!filesMap?.['statementPages']?.length;

      if (hasStatement && hasPages) {
        return errorResponse(res, {
          status: 400,
          code: 'mixed_fields',
          message: 'Use either statement or statementPages, not both.',
          stage: 'validated',
          requestId,
        });
      }
      if (!hasStatement && !hasPages) {
        return errorResponse(res, {
          status: 400,
          code: 'missing_input',
          message: 'No file provided.',
          stage: 'validated',
          requestId,
        });
      }

      const fieldName: 'statement' | 'statementPages' | null = hasStatement
        ? 'statement'
        : hasPages
          ? 'statementPages'
          : null;
      const files = fieldName ? (filesMap?.[fieldName] ?? []) : [];

      // Multer already enforces fileSize; but map LIMIT_FILE_SIZE to 413
      // Validation via service
      const validation = ingestionService.validateInput(
        files.map((f) => ({
          buffer: f.buffer,
          originalname: f.originalname,
          mimetype: f.mimetype,
          size: f.size,
        })),
        fieldName,
      );
      if ('error' in validation) {
        return errorResponse(res, { ...validation.error, requestId });
      }

      const result = await ingestionService.process(
        validation.validated,
        requestId,
      );
      if ('error' in result) {
        return errorResponse(res, { ...result.error, requestId });
      }
      res.status(201).json(result.result);
    } catch (e) {
      const err = e as Error & { code?: string };
      // Multer errors
      if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT') {
        return errorResponse(res, {
          status: 413,
          code: 'limit_exceeded',
          message: 'Upload exceeds size or file count limit.',
          stage: 'validated',
          requestId,
        });
      }
      // generic
      return errorResponse(res, {
        status: 400,
        code: 'bad_request',
        message: 'Bad request.',
        stage: 'validated',
        requestId,
      });
    }
  },
);

router.get('/:id/extraction', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  // Validate opaque id format (UUID) but allow any non-empty
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  }
  const r = ingestionService.getExtraction(id);
  if ('error' in r) {
    return errorResponse(res, { ...r.error, requestId });
  }
  res.json(r.result);
});

router.delete('/:id', (req, res) => {
  const id = (req.params as { id: string }).id;
  ingestionService.clearSession(id);
  unmarkDemoSession(id);
  // Idempotent 204 even if unknown
  res.status(204).send();
});

// Phase 2 - History import
router.post(
  '/:id/history/import',
  historyUpload.single('history'),
  async (req, res) => {
    const requestId = makeRequestId();
    const id = (req.params as { id: string }).id;
    if (!id || id.length < 10) {
      return errorResponse(res, {
        status: 404,
        code: 'session_not_found',
        message: 'Session not found.',
        stage: 'validated',
        requestId,
      });
    }
    const existing = globalSessionStore.get(id);
    if (!existing) {
      return errorResponse(res, {
        status: 404,
        code: 'session_not_found',
        message: 'Session not found or cleared.',
        stage: 'complete',
        requestId,
      });
    }
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      return errorResponse(res, {
        status: 400,
        code: 'missing_input',
        message: 'No history file provided.',
        stage: 'validated',
        requestId,
      });
    }
    // Ensure exactly one file and field name 'history' handled by multer single - but check size
    // Do not log file name or bytes
    // Preserve previous valid history on failure
    const previousRecords = globalSessionStore.getHistoryRecords(id);
    const previousCatalog = globalSessionStore.getCatalog(id);
    const previousSummary = globalSessionStore.getHistorySummary(id);

    const parsed = parseHistoryCsv(file.buffer);
    if ('error' in parsed) {
      // No state change, retain previous
      const codeMap: Record<string, number> = {
        history_schema_invalid: 422,
        history_invalid_record: 422,
        history_unsupported_currency: 422,
        history_empty_categories: 422,
        history_duplicate_record_id: 422,
        history_limit_exceeded: 413,
      };
      const status = codeMap[parsed.error.code] ?? 422;
      // On failure, retain previous valid history unchanged - already not updated
      // Ensure we don't leak raw rows: safe message only
      return errorResponse(res, {
        status,
        code: parsed.error.code,
        message: parsed.error.message,
        stage: 'validated',
        requestId,
      });
    }

    // Build catalog and validate ambiguous categories
    const catalogRes = buildCatalog(parsed.records);
    if ('error' in catalogRes) {
      return errorResponse(res, {
        status: 422,
        code: catalogRes.error.code,
        message: catalogRes.error.message,
        stage: 'validated',
        requestId,
      });
    }

    const summaryBase = {
      recordCount: parsed.summary.recordCount,
      categoryCount: parsed.summary.categoryCount,
      accountCount: parsed.summary.accountCount,
      adapterId: historyAdapterMeta.adapterId,
      adapterVersion: historyAdapterMeta.adapterVersion,
      historyVersion: 0, // will be set by store
    };
    const storedSummary = globalSessionStore.setHistory(
      id,
      parsed.records,
      catalogRes.catalog,
      summaryBase,
    );
    if (!storedSummary) {
      return errorResponse(res, {
        status: 404,
        code: 'session_not_found',
        message: 'Session not found.',
        stage: 'complete',
        requestId,
      });
    }

    // Return only summary, not raw history
    res.status(201).json(storedSummary);

    // Ensure previous proposals invalidated atomically (handled inside setHistory)
    void previousRecords;
    void previousCatalog;
    void previousSummary;
  },
);

// Phase 2 - Provider configuration
router.post('/:id/provider', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'validated',
      requestId,
    });
  }
  if (!globalSessionStore.get(id)) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found or cleared.',
      stage: 'complete',
      requestId,
    });
  }
  const { baseUrl, model } = req.body as { baseUrl?: unknown; model?: unknown };
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    return errorResponse(res, {
      status: 400,
      code: 'provider_malformed',
      message: 'Provider baseUrl required.',
      stage: 'validated',
      requestId,
    });
  }
  if (baseUrl.length > 500) {
    return errorResponse(res, {
      status: 400,
      code: 'provider_malformed',
      message: 'Provider baseUrl too long.',
      stage: 'validated',
      requestId,
    });
  }
  if (
    model !== undefined &&
    (typeof model !== 'string' || model.length > 200)
  ) {
    return errorResponse(res, {
      status: 400,
      code: 'provider_malformed',
      message: 'Invalid model.',
      stage: 'validated',
      requestId,
    });
  }
  // Validate loopback server-side before use
  const validation = await validateLoopbackUrl(baseUrl);
  if (!validation.ok) {
    return errorResponse(res, {
      status: 400,
      code: validation.code,
      message: validation.message,
      stage: 'validated',
      requestId,
    });
  }
  const safe = {
    baseUrl: validation.url.toString().replace(/\/$/, ''),
    model: typeof model === 'string' ? model.slice(0, 200) : undefined,
    configured: true,
  };
  // Do not persist if contains sensitive material - we already rejected credentials
  globalSessionStore.setProviderConfig(
    id,
    { baseUrl: safe.baseUrl, model: safe.model },
    safe as never,
  );
  res.json({ baseUrl: safe.baseUrl, model: safe.model, configured: true });
});

router.post('/:id/provider/test', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'validated',
      requestId,
    });
  }
  const phase2 = globalSessionStore.getPhase2(id);
  if (!phase2 || !phase2.providerConfig) {
    return errorResponse(res, {
      status: 422,
      code: 'provider_not_configured',
      message: 'Provider not configured.',
      stage: 'validated',
      requestId,
    });
  }
  const cfg = phase2.providerConfig;
  let provider: OpenAiCompatibleProvider;
  try {
    provider = new OpenAiCompatibleProvider(cfg.baseUrl, cfg.model);
  } catch {
    return errorResponse(res, {
      status: 400,
      code: 'provider_malformed',
      message: 'Provider configuration invalid.',
      stage: 'validated',
      requestId,
    });
  }
  const result = await provider.testConnection();
  // Do not expose prompts, endpoints containing credentials, or raw responses
  // Update safe config with test result (non-sensitive)
  const safe = globalSessionStore.getProviderConfigSafe(id);
  if (safe) {
    const updated = {
      ...safe,
      lastTestedAt: new Date().toISOString(),
      lastTestOk: result.ok,
    };
    globalSessionStore.setProviderConfig(id, cfg, updated as never);
  }
  if (result.ok) {
    res.json({
      reachable: true,
      modelLabel: result.modelLabel ?? cfg.model ?? 'unknown',
    });
  } else {
    res.status(502).json({
      reachable: false,
      message: result.message ?? 'Provider unreachable.',
      requestId,
    });
  }
});

router.get('/:id/history', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  }
  const summary = globalSessionStore.getHistorySummary(id);
  if (!summary) {
    return errorResponse(res, {
      status: 404,
      code: 'history_not_imported',
      message: 'History not imported.',
      stage: 'complete',
      requestId,
    });
  }
  res.json(summary);
});

router.get('/:id/provider', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  }
  const safe = globalSessionStore.getProviderConfigSafe(id);
  if (!safe) {
    return errorResponse(res, {
      status: 404,
      code: 'provider_not_configured',
      message: 'Provider not configured.',
      stage: 'complete',
      requestId,
    });
  }
  res.json(safe);
});

// Categorization
router.post('/:id/categorize', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'validated',
      requestId,
    });
  }
  // Prevent duplicate categorize while pending
  const phase2Before = globalSessionStore.getPhase2(id);
  if (phase2Before?.pendingCategorizationVersion) {
    return errorResponse(res, {
      status: 409,
      code: 'categorization_pending',
      message: 'Categorization already in progress.',
      stage: 'validated',
      requestId,
    });
  }
  const result = await globalClassificationService.categorize(id);
  if ('error' in result) {
    return errorResponse(res, {
      status: result.error.status,
      code: result.error.code,
      message: result.error.message,
      stage: result.error.stage,
      requestId,
    });
  }
  res.status(201).json(result.result);
});

router.get('/:id/proposals', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10) {
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  }
  const result = globalSessionStore.getCategorizationResult(id);
  if (!result) {
    return errorResponse(res, {
      status: 404,
      code: 'proposals_not_found',
      message: 'No proposals for session.',
      stage: 'complete',
      requestId,
    });
  }
  res.json(result);
});

// ---- Phase 3 Review routes ----

router.post('/:id/review/initialize', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const result = globalReviewService.initialize(id);
  if ('error' in result)
    return errorResponse(res, {
      status: result.error.status,
      code: result.error.code,
      message: result.error.message,
      stage: 'complete',
      requestId,
    });
  res.status(201).json({
    ...result,
    items: result.items.map(toReviewListItem),
    catalog: (globalSessionStore.getCatalog(id) ?? []).map(
      (entry) => entry.categoryName,
    ),
  });
});

router.get('/:id/review', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const r = globalReviewService.getReview(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  // Compact row projection plus summary and filter metadata; detailed evidence only for drawer item
  // Impose response-size limit: if too many items (>500), truncate? For now limit to 500 items
  if (r.items.length > 500) {
    return errorResponse(res, {
      status: 413,
      code: 'review_limit_exceeded',
      message: 'Review too large.',
      stage: 'complete',
      requestId,
    });
  }
  res.json({
    items: r.items.map(toReviewListItem),
    summary: r.summary,
    reviewVersion: r.reviewVersion,
    catalog: (globalSessionStore.getCatalog(id) ?? []).map(
      (entry) => entry.categoryName,
    ),
    auditCount: r.audit.length,
  });
});

router.get('/:id/review/summary-export', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const review = globalReviewService.getReview(id);
  if ('error' in review)
    return errorResponse(res, {
      status: review.error.status,
      code: review.error.code,
      message: review.error.message,
      stage: 'complete',
      requestId,
    });
  // Redacted export: generate CSV in memory, generic filename, no sensitive data
  const items = review.items;
  // Build CSV with deterministic column order and RFC escaping
  const headers = [
    'reviewItemId',
    'sourceRowId',
    'date',
    'amountMinor',
    'categoryName',
    'reviewState',
    'outcome',
    'issueCodes',
    'duplicateCandidateIds',
    'kind',
    'parentReviewItemId',
  ];
  const rows: string[][] = [];
  for (const it of items) {
    const issueCodes = it.issues.map((i) => i.code).join('|');
    const dupIds = it.duplicateMatches
      .map((m) => m.candidateReviewItemId)
      .join('|');
    rows.push([
      it.reviewItemId,
      it.sourceRowId,
      it.date,
      String(it.amountMinor),
      it.categoryName ?? '',
      it.reviewState,
      (it.proposal as unknown as { outcome: string }).outcome ?? '',
      issueCodes,
      dupIds,
      it.kind,
      it.parentReviewItemId ?? '',
    ]);
  }
  function escapeCsv(v: string): string {
    if (
      v.includes('"') ||
      v.includes(',') ||
      v.includes('\n') ||
      v.includes('\r')
    )
      return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }
  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...rows.map((r) => r.map(escapeCsv).join(',')),
  ];
  const csv = csvLines.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="review-summary.csv"',
  );
  res.setHeader('X-Review-Version', String(review.reviewVersion));
  res.send(csv);
});

router.get('/:id/review/:reviewItemId', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const r = globalReviewService.getReview(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  const item = r.items.find((i) => i.reviewItemId === reviewItemId);
  if (!item)
    return errorResponse(res, {
      status: 404,
      code: 'review_item_not_found',
      message: 'Item not found.',
      stage: 'complete',
      requestId,
    });
  const entry = globalSessionStore.getEntry(id);
  const source = entry?.result.transactions.find(
    (transaction) => transaction.sourceRowId === item.sourceRowId,
  );
  res.json({
    ...item,
    sourceEvidence: source
      ? {
          source: source.source,
          reference: source.reference,
          extractionConfidence: source.extractionConfidence,
          issues: source.issues,
        }
      : undefined,
    auditSummary: r.audit
      .filter((event) => event.reviewItemId === item.reviewItemId)
      .slice(-20)
      .map(({ action, occurredAt, safeDetails }) => ({
        action,
        occurredAt,
        safeDetails,
      })),
  });
});

router.patch('/:id/review/:reviewItemId', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const parsed = ReviewPatchBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: parsed.error.issues
        .map((i) => i.message)
        .join('; ')
        .slice(0, 200),
      stage: 'validated',
      requestId,
    });
  const { revision, categoryName, payee, note } = parsed.data;
  const r = globalReviewService.editCategoryPayeeNote(
    id,
    reviewItemId,
    revision,
    { categoryName, payee: payee as never, note: note as never },
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ item: r.item, summary: r.summary });
});

router.post('/:id/review/:reviewItemId/return-to-review', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  const parsed = ReviewRevisionBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'A non-negative integer revision is required.',
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.returnToReview(
    id,
    reviewItemId,
    parsed.data.revision,
  );
  if ('error' in r)
    return errorResponse(res, {
      ...r.error,
      stage: 'complete',
      requestId,
    });
  res.json(r);
});

router.post('/:id/review/:reviewItemId/approve', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const body = req.body as { revision?: unknown };
  if (typeof body?.revision !== 'number' || !Number.isInteger(body.revision))
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'revision required.',
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.approveOne(id, reviewItemId, body.revision);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ item: r.item, summary: r.summary });
});

router.post('/:id/review/:reviewItemId/exclude', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const parsed = ReviewExcludeBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: parsed.error.issues
        .map((i) => i.message)
        .join('; ')
        .slice(0, 200),
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.excludeOne(
    id,
    reviewItemId,
    parsed.data.revision,
    parsed.data.exclusionReason,
    parsed.data.note,
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ item: r.item, summary: r.summary });
});

router.post('/:id/review/:reviewItemId/reclassify', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const parsed = ReviewReclassifyBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: parsed.error.issues
        .map((i) => i.message)
        .join('; ')
        .slice(0, 200),
      stage: 'validated',
      requestId,
    });
  const r = await globalReviewService.recategorize(
    id,
    reviewItemId,
    parsed.data.revision,
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ item: r.item, summary: r.summary });
});

router.post('/:id/review/:reviewItemId/split', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const parsed = ReviewSplitBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: parsed.error.issues
        .map((i) => i.message)
        .join('; ')
        .slice(0, 200),
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.createSplit(
    id,
    reviewItemId,
    parsed.data.revision,
    parsed.data.splits,
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res
    .status(201)
    .json({ parent: r.parent, children: r.children, summary: r.summary });
});

router.patch('/:id/review/:reviewItemId/split-items/:childId', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  const childId = (req.params as { childId: string }).childId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const body = req.body as {
    revision?: unknown;
    amountMinor?: unknown;
    categoryName?: unknown;
    payee?: unknown;
    note?: unknown;
    description?: unknown;
  };
  if (typeof body.revision !== 'number' || !Number.isInteger(body.revision))
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'revision required.',
      stage: 'validated',
      requestId,
    });
  // Validate unknown fields strict: only allow defined fields
  const allowedKeys = new Set([
    'revision',
    'amountMinor',
    'categoryName',
    'payee',
    'note',
    'description',
  ]);
  for (const k of Object.keys(body))
    if (!allowedKeys.has(k))
      return errorResponse(res, {
        status: 400,
        code: 'bad_request',
        message: `unknown field ${k}`,
        stage: 'validated',
        requestId,
      });
  if (
    body.amountMinor !== undefined &&
    (typeof body.amountMinor !== 'number' ||
      !Number.isInteger(body.amountMinor))
  )
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'amountMinor must be integer.',
      stage: 'validated',
      requestId,
    });
  if (body.categoryName !== undefined && typeof body.categoryName !== 'string')
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'categoryName must be string.',
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.updateSplitChild(
    id,
    reviewItemId,
    childId,
    body.revision,
    {
      amountMinor: body.amountMinor as never,
      categoryName: body.categoryName as never,
      payee: body.payee as never,
      note: body.note as never,
      description: body.description as never,
    },
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ child: r.child, summary: r.summary });
});

router.delete('/:id/review/:reviewItemId/split-items/:childId', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const reviewItemId = (req.params as { reviewItemId: string }).reviewItemId;
  const childId = (req.params as { childId: string }).childId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const body = (req.body ?? {}) as { revision?: unknown };
  // For DELETE, revision may be in body or query? Require body
  if (typeof body.revision !== 'number' || !Number.isInteger(body.revision))
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'revision required.',
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.removeSplit(
    id,
    reviewItemId,
    body.revision,
    childId,
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ summary: r.summary });
});

// Bulk approve preview and execute
router.post('/:id/review/bulk-approve-preview', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const r = globalReviewService.bulkPreview(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json(r);
});

router.post('/:id/review/bulk-approve', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const parsed = ReviewBulkApproveBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: parsed.error.issues
        .map((i) => i.message)
        .join('; ')
        .slice(0, 200),
      stage: 'validated',
      requestId,
    });
  const r = globalReviewService.bulkApprove(id, parsed.data.reviewVersion);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json(r);
});

// ---- Phase 4 Wallet routes ----

function blockDemoIfNeeded(
  id: string,
  res: import('express').Response,
  requestId: string,
): boolean {
  if (isDemoSession(id)) {
    errorResponse(res, {
      status: 422,
      code: 'wallet_not_available_in_demo',
      message:
        'Wallet commit is disabled in synthetic demo. Clear the demo and load a real statement to enable Wallet setup.',
      stage: 'complete',
      requestId,
    });
    return true;
  }
  return false;
}

const WalletConnectBodySchema = z
  .object({ token: z.string().min(10).max(500) })
  .strict();
const WalletSelectionBodySchema = z
  .object({
    walletAccountId: z.string().min(1).max(200),
    mappings: z
      .array(
        z
          .object({
            localCategoryName: z.string().min(1).max(200),
            walletCategoryId: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

router.post('/:id/wallet/connect', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  if (blockDemoIfNeeded(id, res, requestId)) return;
  const parsed = WalletConnectBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'Token required.',
      stage: 'validated',
      requestId,
    });
  // Reject base URL/custom headers - we don't accept them; token only
  if (
    typeof req.body.baseUrl === 'string' ||
    typeof req.body.headers === 'object'
  ) {
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'Custom base URL not allowed.',
      stage: 'validated',
      requestId,
    });
  }
  const result = await globalWalletCommitService.connect(id, parsed.data.token);
  if ('error' in result) {
    return errorResponse(res, {
      status: result.error.status,
      code: result.error.code,
      message: result.error.message,
      stage: 'complete',
      requestId,
    });
  }
  // Never echo token
  res.json({ connected: true });
});

router.get('/:id/wallet/setup', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  // Demo sessions return setup but walletBlocked is communicated via API; we still allow read but connect/commit blocked
  const r = globalWalletCommitService.getSetup(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  // Safe setup/catalog state only; never include token
  const phase4 = globalSessionStore.getPhase4(id);
  res.json({
    connectionState: r.connectionState,
    catalogVersion: r.catalog?.version,
    accounts: r.catalog?.accounts ?? [],
    categories: r.catalog?.categories ?? [],
    selection: r.selection ?? null,
    snapshotId: r.snapshot?.snapshotId ?? null,
    journal: r.journal ?? [],
    rateLimited:
      phase4?.connectionState === 'rate_limited'
        ? phase4.connectionMeta
        : undefined,
    initialSync:
      phase4?.connectionState === 'initial_sync_pending'
        ? phase4.connectionMeta
        : undefined,
  });
});

router.post('/:id/wallet/selection', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  if (blockDemoIfNeeded(id, res, requestId)) return;
  const parsed = WalletSelectionBodySchema.safeParse(req.body);
  if (!parsed.success)
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: parsed.error.issues
        .map((i) => i.message)
        .join('; ')
        .slice(0, 200),
      stage: 'validated',
      requestId,
    });
  const r = globalWalletCommitService.saveSelection(
    id,
    parsed.data.walletAccountId,
    parsed.data.mappings,
  );
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ saved: true });
});

router.post('/:id/wallet/dry-run', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  if (blockDemoIfNeeded(id, res, requestId)) return;
  const r = globalWalletCommitService.createDryRun(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.status(201).json(r.dryRun);
});

router.post('/:id/wallet/commit/:snapshotId', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const snapshotId = (req.params as { snapshotId: string }).snapshotId;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  if (blockDemoIfNeeded(id, res, requestId)) return;
  if (!snapshotId || !/^[0-9a-fA-F-]{36}$/.test(snapshotId)) {
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'Invalid snapshotId.',
      stage: 'validated',
      requestId,
    });
  }
  const r = await globalWalletCommitService.commit(id, snapshotId);
  if ('error' in r) {
    // For rate_limited 429, expose retryAfterMs but still not include raw bodies
    if ('retryAfterMs' in r.error && r.error.retryAfterMs !== undefined) {
      res.setHeader(
        'Retry-After',
        String(Math.ceil((r.error.retryAfterMs as number) / 1000)),
      );
    }
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  }
  res.json({ journal: r.journal });
});

router.post('/:id/wallet/retry', async (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  if (blockDemoIfNeeded(id, res, requestId)) return;
  // Accept no row IDs: if body contains rowIds, reject
  if (req.body && typeof req.body === 'object' && 'rowIds' in req.body) {
    return errorResponse(res, {
      status: 400,
      code: 'bad_request',
      message: 'Row IDs not allowed; retry is server-selected.',
      stage: 'validated',
      requestId,
    });
  }
  const r = await globalWalletCommitService.retry(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ journal: r.journal });
});

router.get('/:id/wallet/results', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const r = globalWalletCommitService.getResults(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json(r);
});

router.get('/:id/wallet/result-summary-export', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const csv = globalWalletCommitService.buildExportCsv(id);
  if (!csv)
    return errorResponse(res, {
      status: 404,
      code: 'no_results',
      message: 'No results to export.',
      stage: 'complete',
      requestId,
    });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="wallet-import-results.csv"',
  );
  res.send(csv);
});

router.post('/:id/wallet/disconnect', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  if (!id || id.length < 10)
    return errorResponse(res, {
      status: 404,
      code: 'session_not_found',
      message: 'Session not found.',
      stage: 'complete',
      requestId,
    });
  const r = globalWalletCommitService.disconnect(id);
  if ('error' in r)
    return errorResponse(res, {
      status: r.error.status,
      code: r.error.code,
      message: r.error.message,
      stage: 'complete',
      requestId,
    });
  res.json({ disconnected: true });
});

// Multer / file size error translation for history import
router.use(
  (
    err: unknown,
    _req: unknown,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const e = err as { code?: string };
    if (
      e &&
      (e.code === 'LIMIT_FILE_SIZE' ||
        e.code === 'LIMIT_FILE_COUNT' ||
        e.code === 'LIMIT_UNEXPECTED_FILE')
    ) {
      return errorResponse(res, {
        status: 413,
        code: 'history_limit_exceeded',
        message: 'History file exceeds size or file count limit.',
        stage: 'validated',
        requestId: makeRequestId(),
      });
    }
    return next(err as never);
  },
);

export default router;
