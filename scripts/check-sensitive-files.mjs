import { execFileSync } from 'node:child_process';

const approvedFixtures = new Set([
  'fixtures/synthetic/bdo/expected_extraction.csv',
  'fixtures/synthetic/bdo/wallet_records_synthetic.csv',
  'fixtures/synthetic/bdo/statement_page_1.jpg',
  'fixtures/synthetic/bdo/statement_page_2.jpg',
  'fixtures/synthetic/bdo/statement_page_3.jpg',
]);
const privateExtensions =
  /\.(?:bmp|csv|gif|heic|jpe?g|ocr\.txt|pdf|png|tiff?|tsv|webp)$/i;
const privateNames = /^(?:\.env(?:\..+)?|.*\.(?:key|pem|token))$/i;

function gitLines(...args) {
  const output = execFileSync('git', args, { encoding: 'utf8' }).trim();
  return output ? output.split('\n') : [];
}

const repositoryFiles = gitLines(
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
);
const unsafeTracked = repositoryFiles.filter((path) => {
  const name = path.split('/').at(-1) ?? path;
  if (path === '.env.example' || approvedFixtures.has(path)) return false;
  return privateExtensions.test(path) || privateNames.test(name);
});

if (unsafeTracked.length > 0) {
  console.error(
    'Potentially private tracked files:\n' + unsafeTracked.join('\n'),
  );
  process.exit(1);
}

const mustBeIgnored = [
  '.env',
  '.env.local',
  'private-statement.pdf',
  'wallet-history.csv',
  'uploads/statement.jpg',
  '.sessions/session.json',
  'ocr-output/statement.ocr.txt',
  'screenshots/financial-data.png',
  'test-results/results.xml',
];
const ignored = new Set(
  gitLines('check-ignore', '--no-index', ...mustBeIgnored),
);
const notIgnored = mustBeIgnored.filter((path) => !ignored.has(path));

if (notIgnored.length > 0) {
  console.error(
    'Sensitive paths not covered by .gitignore:\n' + notIgnored.join('\n'),
  );
  process.exit(1);
}

console.log(
  `Repository safety scan passed (${repositoryFiles.length} repository files, ${mustBeIgnored.length} ignore assertions).`,
);
