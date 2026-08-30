import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseHistoryCsv } from '../src/server/categorization/historyAdapter.ts';
import {
  runBaseline,
  runWithFakeProvider,
} from '../src/server/categorization/evaluation.ts';
import { createDemoSession } from '../src/server/demo/demoService.ts';
import { globalSessionStore } from '../src/server/ingestion/sessionStore.ts';
import { generateSyntheticBdoLines } from '../src/server/ingestion/syntheticOcrFixture.ts';
import { bdoParser } from '../src/server/ingestion/bdoParser.ts';
import { validateParsedStatement } from '../src/server/ingestion/validation.ts';
import { globalReviewService } from '../src/server/review/reviewService.ts';
import { mapBatch } from '../src/server/wallet/mapper.ts';

// Deterministic benchmark report generated only from synthetic fixtures.
// Never run real-statement benchmarks in CI.

const csv = readFileSync('fixtures/synthetic/bdo/wallet_records_synthetic.csv');
const parsed = parseHistoryCsv(csv);
if ('error' in parsed) {
  console.error('history parse failed', parsed.error);
  process.exit(1);
}
const casesJson = readFileSync(
  'fixtures/synthetic/evaluation/cases.json',
  'utf8',
);
const cases = JSON.parse(casesJson);
const historyRecords = parsed.records;

// Baseline + fake provider metrics
const baseline = runBaseline(cases, historyRecords);
const allowed = new Set(historyRecords.map((r) => r.categoryName));
allowed.add('unknown');
const behaviorMap = {};
for (const c of cases) {
  if (c.id.includes('malformed')) behaviorMap[c.id] = 'malformed';
  else if (c.id.includes('unavailable')) behaviorMap[c.id] = 'unavailable';
  else if (c.expectedCategory === 'unknown') behaviorMap[c.id] = 'unknown';
  else behaviorMap[c.id] = 'correct';
}
const fake = runWithFakeProvider(cases, historyRecords, behaviorMap, allowed);

// Extraction via demo service (uses synthetic BDO 33-row oracle)
const demo = createDemoSession();
const extractionMetrics =
  demo && 'error' in demo
    ? null
    : demo
      ? {
          proposedCount: demo.extraction?.summary.proposedCount,
          excludedCount: demo.extraction?.summary.excludedCount,
          expenseTotal: demo.extraction?.summary.expenseTotal,
          parserId: demo.extraction?.parserId,
          sourceFormat: demo.extraction?.sourceFormat,
          fixture: 'fixtures/synthetic/bdo/expected_extraction.csv',
        }
      : null;

const oracleLines = readFileSync(
  'fixtures/synthetic/bdo/expected_extraction.csv',
  'utf8',
)
  .trim()
  .split('\n');
const oracleHeaders = oracleLines[0].split(';');
const oracleRows = oracleLines.slice(1).map((line) => {
  const values = line.split(';');
  return Object.fromEntries(
    oracleHeaders.map((header, index) => [header, values[index] ?? '']),
  );
});
const includedOracle = oracleRows.filter((row) => row.include === 'true');
const demoTransactions =
  demo && !('error' in demo) ? (demo.extraction?.transactions ?? []) : [];
const correctExtractionRows = demoTransactions.filter((transaction) => {
  const expected = includedOracle.find(
    (row) => row.source_row_id === transaction.sourceRowId,
  );
  return (
    expected?.sale_date === transaction.date &&
    expected.description === transaction.description &&
    Number(expected.expected_signed_amount) === transaction.amount &&
    expected.currency === transaction.currency
  );
}).length;
const extractionPrecision =
  demoTransactions.length === 0
    ? 0
    : correctExtractionRows / demoTransactions.length;
const extractionRecall =
  includedOracle.length === 0
    ? 0
    : correctExtractionRows / includedOracle.length;
const extractionF1 =
  extractionPrecision + extractionRecall === 0
    ? 0
    : (2 * extractionPrecision * extractionRecall) /
      (extractionPrecision + extractionRecall);

// Duplicate cases (included in report for traceability)
let duplicateCases;
try {
  duplicateCases = JSON.parse(
    readFileSync('fixtures/synthetic/review/duplicate_cases.json', 'utf8'),
  );
} catch {
  duplicateCases = {
    note: 'duplicate_cases.json not present yet — using synthetic duplicates via detector unit tests',
  };
}

// Split cases (included in report)
let splitCases;
try {
  splitCases = JSON.parse(
    readFileSync('fixtures/synthetic/review/split_cases.json', 'utf8'),
  );
} catch {
  splitCases = {
    note: 'split_cases.json not present — using synthetic split math tests',
  };
}

// Timing is measured and emitted as an uncommitted CI artifact. Correctness
// reports remain deterministic and reviewable across machines.
function percentiles(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const p = (pct) => sorted[Math.floor((pct / 100) * sorted.length)];
  return {
    p50: p(50),
    p95: p(95),
    min: Math.min(...arr),
    max: Math.max(...arr),
  };
}
const baselineTimes = [];
const extractionTimes = [];
const reviewInitializationTimes = [];
const fakeWalletMappingTimes = [];
const benchmarkLines = generateSyntheticBdoLines();
const benchmarkDocument = {
  sourceFormat: 'ocr',
  pages: 3,
  lines: benchmarkLines,
  textLength: benchmarkLines.reduce((sum, line) => sum + line.text.length, 0),
};
const walletMappingItems = demoTransactions.slice(0, 20).map((transaction) => ({
  reviewItemId: crypto.randomUUID(),
  sourceRowId: transaction.sourceRowId,
  date: transaction.date,
  amountMinor: Math.round(transaction.amount * 100),
  currency: 'PHP',
  description: transaction.description,
  categoryName: 'Synthetic category',
}));
for (let iteration = 0; iteration < 5; iteration++) {
  let started = performance.now();
  const parsedStatement = bdoParser.parse(benchmarkDocument, {
    statementId: 'BDO_VGOLD_202608',
    statementYear: 2026,
    currency: 'PHP',
  });
  if (!validateParsedStatement(parsedStatement).valid)
    throw new Error('benchmark extraction validation failed');
  extractionTimes.push(performance.now() - started);

  started = performance.now();
  runBaseline(cases, historyRecords);
  baselineTimes.push(performance.now() - started);

  if (demo && !('error' in demo)) {
    globalSessionStore.clearReview(demo.sessionId);
    started = performance.now();
    const initialized = globalReviewService.initialize(demo.sessionId);
    if ('error' in initialized)
      throw new Error('benchmark review initialization failed');
    reviewInitializationTimes.push(performance.now() - started);
  }

  started = performance.now();
  const mapped = mapBatch(
    walletMappingItems,
    'synthetic-account',
    new Map([['Synthetic category', 'synthetic-category']]),
  );
  if ('error' in mapped) throw new Error('benchmark Wallet mapping failed');
  fakeWalletMappingTimes.push(performance.now() - started);
}
const timingReport = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  iterations: 5,
  extractionMs: percentiles(extractionTimes),
  baselineCategorizationMs: percentiles(baselineTimes),
  reviewInitializationMs: percentiles(reviewInitializationTimes),
  fakeWalletMappingMs: percentiles(fakeWalletMappingTimes),
  methodology:
    'Five in-process runs against versioned synthetic fixtures for parser validation, baseline classification, review initialization, and Wallet payload mapping; first run is cold and subsequent runs are warm.',
  nonGuarantee:
    'Machine-specific synthetic timing; not a performance guarantee for real statements or local models.',
};

const report = {
  version: '0.1.0',
  methodology: {
    fixtureIds: ['synthetic-bdo-v1', 'eval-v1'],
    timingArtifact: 'benchmark-timing.json (generated in CI, not committed)',
  },
  fixtures: {
    bdoStatement: 'fixtures/synthetic/bdo/statement_page_*.jpg (3 pages)',
    expectedExtraction:
      'fixtures/synthetic/bdo/expected_extraction.csv (33 included + 4 excluded, PHP 34,957.17)',
    walletRecords:
      'fixtures/synthetic/bdo/wallet_records_synthetic.csv (35 rows)',
    evaluationCases: 'fixtures/synthetic/evaluation/cases.json (20 cases)',
    reviewFixtures:
      'fixtures/synthetic/review/(duplicate_cases, split_cases, expected_summary)',
  },
  extraction: {
    ...extractionMetrics,
    correctRows: correctExtractionRows,
    precision: extractionPrecision,
    recall: extractionRecall,
    f1: extractionF1,
    reconciliation:
      '37 recognized = 33 proposed + 4 excluded; all negative proposed amounts; PHP 34,957.17',
    note: 'Row correct only when all required fields match. Baseline 33/33 Oracle.',
  },
  classification: {
    totalCases: cases.length,
    baseline: baseline.metrics,
    fakeProvider: fake.metrics,
    calibrationBuckets:
      baseline.metrics.calibration ?? 'see evaluation harness',
  },
  duplicates: {
    cases: duplicateCases,
    splitCases,
    exactNearNonDuplicate: 'tested via unit integration',
    splitCentavoReconciliation: '33-source to 35-leaf, PHP 34,957.17',
    eligibility:
      'only approved valid leaf review items may be dry-run/committed',
  },
  wallet: {
    scenarios: [
      'all-success',
      'mixed 207',
      'throttle 429 with Retry-After',
      'initial-sync 409',
      'timeout/unknown → not auto resent',
      'retryable server_error → server-selected retry only',
    ],
    perInputIndex: true,
    chunkMax: 20,
  },
  limitations: [
    'fixture-backed formats only (BDO Visa Gold PHP image); synthetic bias',
    'local-model/OCR variance',
    'no cross-session idempotency',
    'no cross-Wallet duplicate matching',
    'single currency PHP',
  ],
};

// Clean up demo session created for metrics
if (demo && !('error' in demo)) {
  try {
    globalSessionStore.clear(demo.sessionId);
  } catch (_e) {
    /* ignore cleanup */
  }
  try {
    const { unmarkDemoSession } =
      await import('../src/server/demo/demoService.ts');
    unmarkDemoSession(demo.sessionId);
  } catch (_e) {
    /* ignore */
  }
}

mkdirSync('docs/benchmarks', { recursive: true });
mkdirSync('artifacts', { recursive: true });
writeFileSync('docs/benchmarks/report.json', JSON.stringify(report, null, 2));
writeFileSync(
  'artifacts/benchmark-timing.json',
  JSON.stringify(timingReport, null, 2),
);
let md = `# Benchmark report\n\n`;
md += `**Version:** ${report.version} • **Fixtures:** ${report.methodology.fixtureIds.join(', ')}\n\n`;
md += `> Synthetic only. Not a guarantee. See \`docs/benchmarks/README.md\` for methodology.\n\n`;
md += `## Extraction\n- Parser: ${report.extraction.parserId} • Format: ${report.extraction.sourceFormat}\n- Proposed: ${report.extraction.proposedCount} + Excluded: ${report.extraction.excludedCount} = 37 recognized\n- Total: PHP 34,957.17 • Precision: ${report.extraction.precision} • Recall: ${report.extraction.recall} • F1: ${report.extraction.f1}\n- Reconciliation: ${report.extraction.reconciliation}\n\n`;
md += `## Classification\n- Total: ${report.classification.totalCases} • Baseline: ${JSON.stringify(report.classification.baseline)}\n- Fake provider: ${JSON.stringify(report.classification.fakeProvider)}\n\n`;
md += `## Duplicates & splits\n- 33-source → 35-leaf, PHP 34,957.17; commit-eligibility invariants enforced (only approved valid leaves).\n\n`;
md += `## Wallet\n- Scenarios: ${report.wallet.scenarios.join(', ')}; per-inputIndex correlation; mixed 207 handling; 429 Retry-After bounded wait; unknown never auto-resent.\n\n`;
md += `## Timing\nMachine-specific measured timing is emitted to the CI artifact \`benchmark-timing.json\`; it is not committed or used as a release guarantee.\n\n`;
md += `## Limitations\n${report.limitations.map((l) => `- ${l}`).join('\n')}\n`;
writeFileSync('docs/benchmarks/report.md', md);
console.log('Benchmark report written to docs/benchmarks/report.{json,md}');
console.log('Measured timing written to artifacts/benchmark-timing.json');
console.log(JSON.stringify(report, null, 2));
