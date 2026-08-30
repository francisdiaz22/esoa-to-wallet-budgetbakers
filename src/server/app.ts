import express from 'express';
import sessionRouter from './routes/session.js';
import demoRouter from './demo/router.js';
import diagnosticsRouter from './diagnostics/router.js';
import { TemporaryWorkspace } from './ingestion/workspace.js';
import { globalSessionStore } from './ingestion/sessionStore.js';

export const app = express();
export const healthState = {
  status: 'ok',
  storage: 'ephemeral',
  telemetry: false,
} as const;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_request, response) => {
  response.json(healthState);
});

app.use('/api/session', sessionRouter);
app.use('/api/demo', demoRouter);
app.use('/api/session', diagnosticsRouter);

// Stale workspace cleanup on startup (non-sensitive log only)
try {
  TemporaryWorkspace.cleanupStaleWorkspaces();
} catch {
  console.error('[app] stale cleanup failed (non-sensitive)');
}

// Graceful shutdown: clear sessions/workspaces
function shutdown() {
  try {
    globalSessionStore.clearAll();
  } catch {
    console.error('[app] shutdown clear failed (non-sensitive)');
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
