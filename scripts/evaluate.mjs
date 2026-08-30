import { readFileSync } from 'node:fs';
import {
  runBaseline,
  runWithFakeProvider,
} from '../src/server/categorization/evaluation.ts';
import { parseHistoryCsv } from '../src/server/categorization/historyAdapter.ts';

// Load history from synthetic fixture for evaluation
const csv = readFileSync('fixtures/synthetic/bdo/wallet_records_synthetic.csv');
const parsed = parseHistoryCsv(csv);
if ('error' in parsed) {
  console.error('Failed to parse history fixture', parsed.error);
  process.exit(1);
}
const casesJson = readFileSync(
  'fixtures/synthetic/evaluation/cases.json',
  'utf8',
);
const cases = JSON.parse(casesJson);
const historyRecords = parsed.records;

// Baseline
const baseline = runBaseline(cases, historyRecords);
console.log('=== Baseline evaluation ===');
console.log(JSON.stringify(baseline.metrics, null, 2));

// Fake provider
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
console.log('=== Fake provider evaluation ===');
console.log(JSON.stringify(fake.metrics, null, 2));
console.log(
  'Baseline and fake metrics are deterministic and reproducible from committed fixtures.',
);
