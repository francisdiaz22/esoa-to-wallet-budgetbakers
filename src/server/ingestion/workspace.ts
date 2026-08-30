import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Encrypted temporary workspace per session.
 * - Directory under OS tmp with owner-only perms.
 * - Authenticated encryption (AES-256-GCM) with fresh in-memory key.
 * - No plaintext retained after clear().
 * - Stale cleanup uses explicit prefix and age policy.
 */

const WORKSPACE_ROOT = join(tmpdir(), 'esoa-workspace');
const WORKSPACE_PREFIX = 'esoa-sess-';
const STALE_AGE_MS = 1000 * 60 * 60 * 2; // 2 hours

function ensureRoot() {
  try {
    mkdirSync(WORKSPACE_ROOT, { recursive: true, mode: 0o700 });
  } catch {
    // non-sensitive log only
    console.error('[workspace] failed to ensure root');
  }
}

export class TemporaryWorkspace {
  readonly sessionId: string;
  readonly dir: string;
  private key: Buffer | null;
  private cleared = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    // Never accept user-supplied path — construct explicitly
    this.dir = join(WORKSPACE_ROOT, `${WORKSPACE_PREFIX}${sessionId}`);
    this.key = randomBytes(32);
    ensureRoot();
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  /** Encrypt and write buffer to relative path under workspace dir */
  writeEncrypted(relative: string, data: Buffer): void {
    if (this.cleared || !this.key) throw new Error('workspace cleared');
    if (
      relative.includes('..') ||
      relative.includes('/') ||
      relative.includes('\\')
    ) {
      throw new Error('invalid workspace path');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    // store as iv(12) + tag(16) + ciphertext
    const payload = Buffer.concat([iv, tag, encrypted]);
    const dest = join(this.dir, basename(relative));
    writeFileSync(dest, payload, { mode: 0o600 });
  }

  readEncrypted(relative: string): Buffer {
    if (this.cleared || !this.key) throw new Error('workspace cleared');
    if (
      relative.includes('..') ||
      relative.includes('/') ||
      relative.includes('\\')
    ) {
      throw new Error('invalid workspace path');
    }
    const dest = join(this.dir, basename(relative));
    const payload = readFileSync(dest);
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Idempotent clear: remove dir, zero key, retain no plaintext */
  clear(): void {
    if (this.cleared) return;
    this.cleared = true;
    // zero key
    if (this.key) {
      this.key.fill(0);
      this.key = null;
    }
    try {
      if (existsSync(this.dir)) {
        rmSync(this.dir, { recursive: true, force: true });
      }
    } catch {
      console.error('[workspace] clear failed (non-sensitive)');
    }
  }

  exists(): boolean {
    return existsSync(this.dir);
  }

  static getRoot(): string {
    return WORKSPACE_ROOT;
  }
  static getPrefix(): string {
    return WORKSPACE_PREFIX;
  }

  /** Stale workspace removal on startup — only removes owned prefix, age-gated */
  static cleanupStaleWorkspaces(): number {
    ensureRoot();
    let removed = 0;
    try {
      const entries = readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith(WORKSPACE_PREFIX)) continue;
        const full = join(WORKSPACE_ROOT, entry.name);
        try {
          const stat = statSync(full);
          const age = now - stat.mtimeMs;
          if (age > STALE_AGE_MS) {
            rmSync(full, { recursive: true, force: true });
            removed++;
          }
        } catch {
          console.error(
            '[workspace] stale cleanup entry failed (non-sensitive)',
          );
        }
      }
    } catch {
      console.error('[workspace] stale cleanup failed (non-sensitive)');
    }
    return removed;
  }
}
