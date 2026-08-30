import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { buildDiagnosticsBundle } from './diagnosticsService.js';

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

// GET /api/session/:id/diagnostics/preview — explicit preview before download (redacted, local-only)
router.get('/:id/diagnostics/preview', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const result = buildDiagnosticsBundle(id);
  if ('error' in result) {
    return errorResponse(res, { ...result.error, requestId });
  }
  res.json({
    preview: result.bundle,
    note: 'Preview only — not automatically attached or uploaded. Use download for local file.',
  });
});

// GET /api/session/:id/diagnostics/download — explicit local download, in-memory generation, not persisted
router.get('/:id/diagnostics/download', (req, res) => {
  const requestId = makeRequestId();
  const id = (req.params as { id: string }).id;
  const result = buildDiagnosticsBundle(id);
  if ('error' in result) {
    return errorResponse(res, { ...result.error, requestId });
  }
  const json = JSON.stringify(result.bundle, null, 2);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="diagnostics.json"',
  );
  res.setHeader('X-Diagnostics-Version', result.bundle.reportVersion);
  res.send(json);
});

export default router;
