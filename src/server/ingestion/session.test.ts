import { describe, expect, it } from 'vitest';
import { TemporaryWorkspace } from './workspace.js';
import { SessionStore } from './sessionStore.js';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

describe('TemporaryWorkspace', () => {
  it('encrypts and decrypts, and clear removes dir and key', () => {
    const id = randomUUID();
    const ws = new TemporaryWorkspace(id);
    expect(existsSync(ws.dir)).toBe(true);
    const data = Buffer.from('sensitive statement bytes');
    ws.writeEncrypted('doc.bin', data);
    const out = ws.readEncrypted('doc.bin');
    expect(out.toString()).toBe(data.toString());
    ws.clear();
    expect(existsSync(ws.dir)).toBe(false);
    expect(() => ws.readEncrypted('doc.bin')).toThrow();
    // idempotent
    ws.clear();
  });

  it('rejects path traversal', () => {
    const id = randomUUID();
    const ws = new TemporaryWorkspace(id);
    expect(() => ws.writeEncrypted('../evil', Buffer.from('x'))).toThrow();
    ws.clear();
  });

  it('cleanup only removes owned prefix and aged entries', () => {
    const root = TemporaryWorkspace.getRoot();
    const prefix = TemporaryWorkspace.getPrefix();
    const staleId = `stale-test-${randomUUID()}`;
    const freshId = `fresh-test-${randomUUID()}`;
    const staleDir = join(root, `${prefix}${staleId}`);
    const freshDir = join(root, `${prefix}${freshId}`);
    const otherDir = join(root, `other-${randomUUID()}`);
    mkdirSync(staleDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(staleDir, 'x'), 'x');
    // make stale appear 3 hours ago
    const oldTime = Date.now() - 1000 * 60 * 60 * 3;
    utimesSync(staleDir, new Date(oldTime), new Date(oldTime));
    const removed = TemporaryWorkspace.cleanupStaleWorkspaces();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(staleDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(otherDir)).toBe(true);
    // cleanup test dirs
    rmSync(freshDir, { recursive: true, force: true });
    rmSync(otherDir, { recursive: true, force: true });
  });
});

describe('SessionStore', () => {
  it('creates, gets, and clears idempotently', () => {
    const store = new SessionStore();
    const sid = SessionStore.generateId();
    const ws = new TemporaryWorkspace(sid);
    const result = store.createWithId(
      sid,
      {
        parserId: 'bdo-visa-gold-ph-image-v1',
        sourceFormat: 'ocr',
        transactions: [],
        excludedRows: [],
        issues: [],
        summary: { proposedCount: 0, excludedCount: 0, expenseTotal: 0 },
      },
      ws,
    );
    expect(result.sessionId).toBe(sid);
    expect(store.get(sid)?.sessionId).toBe(sid);
    expect(store.has(sid)).toBe(true);
    expect(store.clear(sid)).toBe(true);
    expect(store.get(sid)).toBeNull();
    expect(existsSync(ws.dir)).toBe(false);
    // idempotent second clear: returns false, no throw
    expect(store.clear(sid)).toBe(false);
    expect(store.clear('nonexistent')).toBe(false);
  });

  it('clearAll removes all sessions', () => {
    const store = new SessionStore();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const sid = SessionStore.generateId();
      ids.push(sid);
      const ws = new TemporaryWorkspace(sid);
      store.createWithId(
        sid,
        {
          parserId: 'p',
          sourceFormat: 'ocr',
          transactions: [],
          excludedRows: [],
          issues: [],
          summary: { proposedCount: 0, excludedCount: 0, expenseTotal: 0 },
        },
        ws,
      );
      const historyVersion = 1;
      const summary = {
        recordCount: 1,
        categoryCount: 1,
        accountCount: 1,
        adapterId: 'wallet-history-csv',
        adapterVersion: '1.0.0',
        historyVersion,
      };
      store.setHistory(
        sid,
        [
          {
            recordId: `history-${i}`,
            date: '2026-07-29',
            description: 'Synthetic history',
            amountMinor: -10000,
            currency: 'PHP',
            categoryName: 'Shopping',
          },
        ],
        [
          {
            categoryId: 'cat-shopping',
            categoryName: 'Shopping',
            exampleCount: 1,
          },
        ],
        summary,
      );
      const proposal = {
        proposalId: `proposal-${i}`,
        sourceRowId: `p1-r00${i}`,
        categoryName: 'Shopping',
        classificationConfidence: 0.9,
        rationale: 'Synthetic match.',
        outcome: 'proposed' as const,
        reviewState: 'needs_review' as const,
        retrieval: [],
        issues: [],
      };
      store.setProposals(
        sid,
        [proposal],
        {
          sessionId: sid,
          historyVersion,
          proposals: [proposal],
          summary: {
            total: 1,
            byOutcome: {
              proposed: 1,
              unknown: 0,
              low_confidence: 0,
              provider_unavailable: 0,
              provider_malformed: 0,
            },
          },
        },
        historyVersion,
      );
      expect(store.getHistoryRecords(sid)).toHaveLength(1);
      expect(store.getCatalog(sid)).toHaveLength(1);
      expect(store.getProposals(sid)).toHaveLength(1);
    }
    expect(store.size()).toBe(3);
    store.clearAll();
    expect(store.size()).toBe(0);
    for (const id of ids) {
      expect(store.getHistoryRecords(id)).toBeNull();
      expect(store.getCatalog(id)).toBeNull();
      expect(store.getProposals(id)).toBeNull();
      expect(
        existsSync(
          join(
            TemporaryWorkspace.getRoot(),
            `${TemporaryWorkspace.getPrefix()}${id}`,
          ),
        ),
      ).toBe(false);
    }
  });
});
