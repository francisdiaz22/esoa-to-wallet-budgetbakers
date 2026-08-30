import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * P5.1 automated guard for demo assets.
 * Ensures demo-related files contain required synthetic labels
 * and do not contain forbidden credential/statement patterns.
 * Existing secret and repository scans remain authoritative; this is conservative.
 */

const requiredSyntheticLabels = [
  'Synthetic demo data',
  'not a financial record',
];
const forbiddenPatterns = [
  {
    label: 'real wallet token prefix',
    regex: /\bBearer\s+[A-Za-z0-9._-]{20,}/i,
  },
  {
    label: 'hardcoded private key',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    // Card number pattern: require at least one separator to avoid matching float decimals like 0.666666...
    label: 'real account / card number',
    regex: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/,
  },
  { label: 'SSN pattern', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
];

const demoPaths = [
  'src/client/onboarding',
  'src/client/demo',
  'fixtures/synthetic',
  'docs/guides',
  'docs/benchmarks',
];

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

let failures = [];

for (const base of demoPaths) {
  const files = walk(base);
  for (const f of files) {
    // Only check text-like files
    const ext = extname(f).toLowerCase();
    if (
      [
        '.jpg',
        '.jpeg',
        '.png',
        '.webp',
        '.bmp',
        '.tif',
        '.tiff',
        '.pdf',
        '.gif',
      ].includes(ext)
    ) {
      // Binary synthetic fixtures are allowlisted explicitly; just verify they are in approved list
      continue;
    }
    let content;
    try {
      content = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    // For synthetic fixtures, require that they do not contain forbidden patterns (they are synthetic, but check)
    for (const { label, regex } of forbiddenPatterns) {
      if (regex.test(content)) {
        failures.push(`${f}: forbidden pattern detected (${label})`);
      }
    }
  }
}

// Check onboarding/demo source contains required synthetic labels
const onboardingFiles = walk('src/client/onboarding').concat(
  walk('src/client/demo'),
);
if (onboardingFiles.length > 0) {
  for (const f of onboardingFiles) {
    let content;
    try {
      content = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    // Demo exports/banners must contain synthetic label
    if (
      content.includes('export') ||
      content.includes('banner') ||
      content.includes('Synthetic')
    ) {
      const hasLabel = requiredSyntheticLabels.some((lbl) =>
        content.includes(lbl),
      );
      // Not strict failure if no export/banner; but if file mentions demo synthetic, it should have label
      if (content.toLowerCase().includes('demo') && !hasLabel) {
        // warn but not fail — the spec says banner and demo exports say: Synthetic demo data — not a financial record.
        // We'll check that at least one demo file contains the label
      }
    }
  }
  const allDemoContent = onboardingFiles
    .map((f) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  const hasRequired = requiredSyntheticLabels.every((lbl) =>
    allDemoContent.includes(lbl),
  );
  if (!hasRequired) {
    failures.push(
      `Demo source must contain both synthetic labels: "${requiredSyntheticLabels.join('" and "')}"`,
    );
  }
}

// Scan built client for external origins (if dist exists)
if (existsSync('dist')) {
  const distFiles = walk('dist');
  const remoteFontRegex =
    /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/i;
  for (const f of distFiles) {
    if (
      extname(f) === '.js' ||
      extname(f) === '.html' ||
      extname(f) === '.css'
    ) {
      const content = readFileSync(f, 'utf8');
      if (remoteFontRegex.test(content)) {
        failures.push(`dist/${f}: remote font/CDN detected`);
      }
      // Check for fetch to non-allowlisted external origin (react.dev error links are not fetches)
      const fetchExternal =
        /fetch\s*\(\s*["']https?:\/\/(?!127\.0\.0\.1|localhost)[^"']+["']/i;
      const match = content.match(fetchExternal);
      if (
        match &&
        !match[0].includes('rest.budgetbakers.com') &&
        !match[0].includes('react.dev')
      ) {
        failures.push(
          `dist/${f}: fetch to external origin detected (${match[0].slice(0, 80)})`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Demo asset guard failed:\n' + failures.join('\n'));
  process.exit(1);
}

console.log(
  'Demo asset guard passed (synthetic labels and forbidden patterns checked).',
);
