# Contributing

## Local setup

Install Node.js 22 or newer, then run:

```sh
npm ci
cp .env.example .env
npm run dev
```

Open http://127.0.0.1:4300. The browser UI proxies to the local service at http://127.0.0.1:4310. Both bind only to loopback (`127.0.0.1`/`localhost`).

## Layout

```
src/client/            # React UI (onboarding, import, history, provider, categorization, review, wallet, diagnostics)
src/client/onboarding/ # state-derived onboarding panel (no browser storage)
src/server/ingestion/  # CSV/PDF/image extractors, BDO parser, normalizer/validator, workspace, limits
src/server/categorization/ # history adapter, catalog, retrieval, baseline, provider, classificationService, evaluation
src/server/review/     # duplicate detector, validator, reviewService, audit, Handoff projection
src/server/wallet/     # contracts, fixed-base Wallet client, mapper, commitService, journal
src/server/demo/       # offline synthetic demo (uses normal paths, synthetic fixtures only)
src/server/diagnostics/# redacted bundle (preview + local download)
fixtures/synthetic/    # versioned synthetic fixtures only (allowlisted)
docs/guides/           # parser-authoring, model-provider-authoring, operations-and-troubleshooting
docs/benchmarks/       # report.json/md, methodology, limits
scripts/               # evaluate, benchmark, scans
e2e/                   # Playwright (Chrome, loopback, network-blocked where required)
```

## Required checks

Before submitting a change, run:

```sh
npm run check          # format:check + lint + typecheck + test + test:e2e + eval + benchmark + scan:secrets + scan:repository + scan:demo + scan:external
npm run audit
npm run build
```

- Use Node 22, locked `npm ci`, Chrome for `test:e2e`/`check`.
- CI (`ci.yml`) runs the same gates from a clean clone with no credential or statement required.

## Fixture policy

- Use **synthetic data only**. Redaction alone does not make a real statement suitable.
- Do not commit statements, Wallet history exports, prompts, OCR output, API responses, tokens, session files, diagnostic bundles, or financial screenshots/recordings.
- A synthetic binary fixture (jpg/pdf/csv) must receive an explicit path allowlist in `.gitignore` after a reviewer confirms its provenance and checks metadata (fake identifiers, stripped barcodes). Never broaden ignores to make a fixture pass. Validate with `npm run scan:repository` and `npm run scan:demo`.
- Use obvious fake identifiers, accounts, names, references. Every record in demo exports must visibly say `Synthetic demo data — not a financial record`.
- Do not add analytics, hosted error reporting, remote fonts/CDNs, cloud models, or new external origins; Wallet (`https://rest.budgetbakers.com/wallet`) remains the only optional runtime external origin, and the browser never contacts it.

## Documentation expectations

- Update `README.md` with scope, privacy boundary, support status, quick start, synthetic demo, local-model options, review/commit safety, commands, and limitations; link to runbooks (`IMPLEMENTATION.md`, `IMPLEMENT_phase*.md`, `SECURITY.md`, ADRs) rather than duplicating contracts.
- For a new parser or provider, follow `docs/guides/parser-authoring.md` and `model-provider-authoring.md` — fixture-proven, deterministic, and test-covered.
- Add `docs/benchmarks/README.md` entries for any new metrics; keep claims reproducible and qualified.
- Run a link check before PR; docs must contain no real token/account/statement/prompt.

## Testing matrix

| Layer                   | What to cover (see `IMPLEMENT_phase*.md` test matrix)                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract/unit           | Zod schemas, decimal helpers, normalizers, catalog, retrieval tie-breakers, split math, audit redaction                                                                                                    |
| Parser/unit             | New row, multi-page, continuations, orphan cases, each exclusion, sign, malformed date/amount, ambiguous OCR                                                                                               |
| Fixture/integration     | Synthetic import through public API (statementPages order, history BOM/quoted handling, limits), exact oracle row-by-row + totals                                                                          |
| Evaluation              | `npm run eval` + `npm run benchmark` deterministic on synthetic fixtures, metric calculations, zero-denominator                                                                                            |
| Route/integration       | Multipart, MIME/signature mismatch, zero/oversize, encrypted PDF, unsupported layout (`422`), session clear/shutdown, demo offline, diagnostics redaction                                                  |
| Privacy/regression      | Network blocked during import/categorization/review/Wallet; no raw excerpts/tokens/paths in logs/snapshots; `scan:external` clean                                                                          |
| UI/component            | Keyboard focus trap/return, Escape, live regions, table → card reflow, split mismatch, bulk preview, blocked commit in demo                                                                                |
| E2E (Playwright/Chrome) | Synthetic statement → history → fake-loopback provider → categorize → review → split → approve/exclude → export → diagnostics → demo start/banner/review action/blocked commit/clear, no external requests |

## Pull requests

Keep changes scoped, add fixture-driven tests, and explain privacy implications. Attach the **sensitive-data attestation** (no real token/statement, synthetic only) and include commands/results, accessibility/browser matrix, benchmark path/version/fixture IDs, and demo instructions.

If this is your first PR, run the synthetic demo offline (`Load synthetic demo` button or `POST /api/demo`) through review with network disabled to verify your environment.

See `.github/pull_request_template.md` and issue templates.

## Security

See `SECURITY.md` for the private vulnerability reporting process. Revoke a credential immediately if it enters Git history.
