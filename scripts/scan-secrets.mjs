import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'dist-server',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const binaryExtensions = /\.(?:bmp|gif|heic|ico|jpe?g|pdf|png|tiff?|webp)$/i;
const signatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/],
  ['hard-coded bearer token', /\bBearer\s+[A-Za-z0-9_-]{24,}\b/i],
];
const findings = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (binaryExtensions.test(entry.name)) continue;

    const contents = readFileSync(path, 'utf8');
    for (const [label, signature] of signatures) {
      if (signature.test(contents))
        findings.push(`${relative(root, path)}: ${label}`);
    }
  }
}

walk(root);

if (findings.length > 0) {
  console.error('Possible secrets detected:\n' + findings.join('\n'));
  process.exit(1);
}

console.log('Secret scan passed.');
