import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type CsvRow = Record<string, string>;

function readSemicolonCsv(relativePath: string): CsvRow[] {
  const lines = readFileSync(resolve(relativePath), 'utf8').trim().split('\n');
  const headers = lines[0].split(';');

  return lines
    .slice(1)
    .map((line) =>
      Object.fromEntries(
        line.split(';').map((value, index) => [headers[index], value]),
      ),
    );
}

describe('synthetic BDO fixtures', () => {
  const expectedRows = readSemicolonCsv(
    'fixtures/synthetic/bdo/expected_extraction.csv',
  );
  const walletRows = readSemicolonCsv(
    'fixtures/synthetic/bdo/wallet_records_synthetic.csv',
  );

  it('contains the expected included and excluded source rows', () => {
    const included = expectedRows.filter((row) => row.include === 'true');
    const excluded = expectedRows.filter((row) => row.include === 'false');
    const total = included.reduce(
      (sum, row) => sum + Number(row.raw_amount),
      0,
    );

    expect(expectedRows).toHaveLength(37);
    expect(included).toHaveLength(33);
    expect(excluded).toHaveLength(4);
    expect(total).toBeCloseTo(34_957.17, 2);
    expect(new Set(expectedRows.map((row) => row.source_row_id)).size).toBe(
      expectedRows.length,
    );
  });

  it('reconciles the post-review Wallet rows to every source charge', () => {
    const expectedAmounts = new Map(
      expectedRows
        .filter((row) => row.include === 'true')
        .map((row) => [row.source_row_id, Number(row.expected_signed_amount)]),
    );
    const walletAmounts = new Map<string, number>();

    for (const row of walletRows) {
      walletAmounts.set(
        row.source_row_id,
        (walletAmounts.get(row.source_row_id) ?? 0) + Number(row.amount),
      );
    }

    expect(walletRows).toHaveLength(35);
    expect(walletAmounts.size).toBe(33);
    expect([...walletAmounts.entries()]).toEqual(
      expect.arrayContaining([...expectedAmounts.entries()]),
    );
    expect(
      walletRows.reduce((sum, row) => sum + Number(row.amount), 0),
    ).toBeCloseTo(-34_957.17, 2);
  });
});
