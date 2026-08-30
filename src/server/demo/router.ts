import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  createDemoSession,
  DEMO_VERSION,
  DEMO_FIXTURE_ID,
  isDemoSession,
} from './demoService.js';

const router = Router();

function makeRequestId(): string {
  return randomUUID();
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
  res.status(err.status).json({
    code: err.code,
    message: err.message,
    stage: err.stage,
    requestId: err.requestId ?? makeRequestId(),
  });
}

// POST /api/demo — create offline synthetic demo session through extraction, categorization, review
router.post('/', (_req, res) => {
  const requestId = makeRequestId();
  const result = createDemoSession();
  if ('error' in result) {
    return errorResponse(res, { ...result.error, requestId });
  }
  res.status(201).json({
    sessionId: result.sessionId,
    parserId: result.extraction?.parserId,
    statementId: result.extraction?.statementId,
    sourceFormat: result.extraction?.sourceFormat,
    summary: result.extraction?.summary,
    historySummary: result.historySummary,
    categorizationSummary: result.categorizationResult?.summary,
    reviewSummary:
      'summary' in (result.review as object)
        ? (result.review as { summary: unknown }).summary
        : undefined,
    demoVersion: DEMO_VERSION,
    fixtureId: DEMO_FIXTURE_ID,
    isDemo: true,
    banner: 'Synthetic demo data — not a financial record.',
    walletBlocked: true,
    walletBlockedReason:
      'Wallet commit is disabled in synthetic demo. Load a real statement to enable Wallet setup.',
  });
});

// GET /api/demo/:id/status — check if session is demo (for banner)
router.get('/:id/status', (req, res) => {
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
  res.json({
    isDemo: isDemoSession(id),
    banner: isDemoSession(id)
      ? 'Synthetic demo data — not a financial record.'
      : undefined,
    demoVersion: isDemoSession(id) ? DEMO_VERSION : undefined,
  });
});

export default router;
