import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeOcrEngine } from './extractors.js';
import { IngestionService } from './ingestionService.js';
import { SessionStore } from './sessionStore.js';
import { generateSyntheticBdoLines } from './syntheticOcrFixture.js';

afterEach(() => vi.restoreAllMocks());

describe('ingestion privacy regression', () => {
  it('does not log document bytes, OCR excerpts, filenames, or request tokens', async () => {
    const logs: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
    const store = new SessionStore();
    const service = new IngestionService(
      store,
      new FakeOcrEngine(generateSyntheticBdoLines()),
    );
    const marker = 'PRIVATE_BYTES_MARKER_7f3a';
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from(marker),
    ]);
    const validated = service.validateInput(
      [
        {
          buffer,
          originalname: `${marker}.jpg`,
          mimetype: 'image/jpeg',
          size: buffer.length,
        },
      ],
      'statement',
    );
    expect('validated' in validated).toBe(true);
    if (!('validated' in validated)) return;

    const processed = await service.process(
      validated.validated,
      `TOKEN_${marker}`,
    );
    expect('result' in processed).toBe(true);
    if (!('result' in processed)) return;
    service.clearSession(processed.result.sessionId);

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain(marker);
    expect(serializedLogs).not.toContain('PC EXPRESS');
    expect(store.size()).toBe(0);
  });
});
