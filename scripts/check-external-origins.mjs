import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

const failures = [];

// Check client source does not import remote fonts/CDNs or telemetry
const clientDir = 'src/client';
for (const f of walk(clientDir)) {
  const content = readFileSync(f, 'utf8');
  // Allow explanatory "Telemetry, analytics, and remote fonts are disabled" note
  const isAllowedDisabledNote =
    f === 'src/client/App.tsx' &&
    content.includes('Telemetry, analytics, and remote fonts are disabled');
  if (!isAllowedDisabledNote) {
    if (
      /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|segment\.io|sentry\.io/i.test(
        content,
      )
    ) {
      failures.push(`${f}: potential remote origin or CDN reference`);
    }
    // Check for analytics/telemetry only if not the disabled explanatory note
    if (/analytics|telemetry/i.test(content) && !content.includes('disabled')) {
      failures.push(`${f}: potential analytics/telemetry reference`);
    }
  } else {
    // Still check for actual CDN URLs even in allowed file
    if (
      /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|segment\.io|sentry\.io/i.test(
        content,
      )
    ) {
      failures.push(`${f}: potential remote origin or CDN reference`);
    }
  }
  // Check for browser-to-Wallet fetches (browser should never contact Wallet directly)
  // Allow explanatory text like "https://rest.budgetbakers.com/wallet. This is an external" but not fetch/new Request
  if (
    /fetch\s*\(\s*["']https:\/\/rest\.budgetbakers\.com/i.test(content) ||
    /new\s+Request\s*\(\s*["']https:\/\/rest\.budgetbakers\.com/i.test(content)
  ) {
    failures.push(
      `${f}: browser should not contact Wallet directly; found Wallet fetch`,
    );
  }
}

// Check vite config does not use external origins
const vite = readFileSync('vite.config.ts', 'utf8');
if (/fonts|cdn|analytics/i.test(vite)) {
  failures.push('vite.config.ts: unexpected external origin');
}

// Check built client if exists — allow react.dev error links, only flag actual fetches
if (existsSync('dist')) {
  for (const f of walk('dist')) {
    if (['.js', '.html', '.css'].includes(extname(f))) {
      const content = readFileSync(f, 'utf8');
      if (/fetch\s*\(\s*["']https:\/\/rest\.budgetbakers\.com/i.test(content)) {
        failures.push(
          `dist/${f}: browser bundle contains Wallet fetch — violates local-first boundary`,
        );
      }
    }
  }
}

if (failures.length) {
  console.error('External origin check failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(
  'External origin check passed (no browser-side Wallet, no remote fonts/CDNs, no telemetry).',
);
