import express from 'express';

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
