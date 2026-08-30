# eSOA to Wallet

A local-first web application for converting electronic statements of account
into reviewed transactions for Wallet by BudgetBakers.

The application will extract statement rows, suggest categories using a local
model and imported Wallet history, provide a human review step, and submit only
approved transactions through the Wallet REST API. Financial data stays on the
user's machine and telemetry is disabled by default.

> **Current status:** Phase 5 complete — product polish, extensibility, and public release. Onboarding is state-derived (not persisted) and demo works offline through review (`Synthetic demo data — not a financial record`, Wallet disabled). Accessibility at WCAG 2.2 AA where applicable (semantic controls, keyboard, visible focus, aria-live, 320px + 200% zoom), diagnostics is explicit/previewable/local-only/redacted, benchmarks are reproducible from synthetic fixtures, and governance/release workflow is manual and owner-approved. See `IMPLEMENTATION.md`, `IMPLEMENT_phase5.md`, `docs/benchmarks/README.md`, and `docs/release/RELEASE.md`.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git
- Google Chrome for `npm run test:e2e` / `npm run check`

No statement, Wallet export, API token, local model, or network connection is
needed after dependencies have been installed.

## Start locally

```sh
git clone <repository-url>
cd esoa-to-wallet-budgetbakers
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:4300>. The browser UI proxies API requests to the local
service at <http://127.0.0.1:4310>. Both development services bind only to the
loopback interface (`127.0.0.1`/`localhost`).

## Synthetic demo (no credentials, offline, labelled)

The app works without a real statement, Wallet export, token, local model, or network connection. The demo uses only committed, clearly labelled synthetic fixtures and stops before any Wallet write.

1. Run `npm run dev` and open http://127.0.0.1:4300 with network enabled.
2. Click **Load synthetic demo** in the onboarding panel. The server creates a demo session via `POST /api/demo` using the allowlisted `fixtures/synthetic/bdo/statement_page_*.jpg` (via deterministic `TextLine` fixtures) and `wallet_records_synthetic.csv`; categorization uses baseline + in-process fake (no model/Wallet network).
3. Review the banner **Synthetic demo data — not a financial record** visibly labelling every record. Try a review action (approve, split, duplicate candidate) and note that **Wallet setup/commit is unavailable with an explanation, not hidden** — no token field will succeed (`wallet_not_available_in_demo`).
4. With all non-loopback network blocked, the demo still runs through extraction → categorization → review. Verify no request reaches Wallet or a model endpoint (Playwright `e2e/demo.spec.ts` asserts this).
5. Downloads (`review-summary.csv`, diagnostics) are also labelled `Synthetic demo data — not a financial record`. Clear the session to start a live workflow.

`npm run demo` is documented as the UI action. An additional `npm run demo` script that would be offline/non-interactive is deferred to `docs/release/RELEASE.md`.

## Onboarding

Guidance is keyboard-operable and derives from active session state (`hasExtraction`, `hasHistory`, provider status, proposals/review counts, `isDemo`). It does not persist completion or configuration. Dismissing the guide reappears after refresh or **Clear session** — no browser storage is used. Steps: local processing notice → import/demo → history → loopback model test (manual review still possible if unavailable) → review/approve → optional explicit Wallet commit.

## Import & clear-session behavior

- Open the UI and drag a document (or ordered image pages) onto the drop zone or use the file picker. Accepted browser hints: `.csv`, `.pdf`, `.jpg/.jpeg`, `.png`, `.webp`, `.tif/.tiff`, `.bmp`.
- Single file uses `statement`; 2–10 images use ordered `statementPages` (the BDO 3-page synthetic fixture uses the latter in ascending page order). Mixing both fields is rejected.
- Files are validated by magic bytes/content, not extension alone. Zero-byte, oversize, path-like names, MIME/signature mismatches, unsupported types, and encrypted PDFs are rejected with stable `code`/`stage`/`requestId` errors — without echoing document contents, stack traces, or filesystem paths.
- While pending, the UI shows progress and prevents duplicate submission.
- On success the screen shows parser ID, source format, proposed/excluded counts, and absolute PHP expense total (33 proposed + 4 excluded = 37 rows, PHP 34,957.17 for the BDO fixture). Here **Proposed** means “included as an extracted transaction”; it is unrelated to the later Phase 2 `proposed` categorization outcome. A table lists date, description, amount, source page/row, extraction confidence, and issue status; each row has a keyboard-operable source-detail affordance (page, row, parser ID, raw excerpt, reference, validation issues). See “Understanding extraction results” below for the exact meanings.
- After extraction, import a Wallet-native export or synthetic history CSV (see “Supported Wallet history schemas” below). The UI shows only a safe summary (record count, category count, account count); it never renders raw history rows in errors or logs. Replacing history invalidates prior proposals atomically; a failed replacement leaves the prior valid history and proposals intact.
- Configure a local provider (loopback OpenAI-compatible endpoint, e.g., Ollama at `http://127.0.0.1:11434`). Use **Test local connection** to verify reachability without sending statement/history data. The server is the only process that contacts the provider; browser JavaScript never receives prompts, credentials, or raw replies.
- Choose **Categorize transactions** when history and provider are ready (baseline exact-match proposals are used when unambiguous, otherwise the local provider is called with bounded input). Every extracted row receives exactly one `CategoryProposal` (`proposed`/`unknown`/`low_confidence`/`provider_unavailable`/`provider_malformed`, all `needs_review`) with bounded retrieval evidence and a concise rationale. Categories are from the active-session history catalog or `unknown` (never silently mapped).
- After categorization, open the **Review workspace**: a summary strip (needs review/approved/excluded/blockers/duplicates/approved total), filter chips (needs review, warnings/errors, duplicates, approved, excluded), a semantic table (state, date, description, amount, category, confidence/outcome, issues, duplicate marker, details), and a keyboard-operable detail drawer (source excerpt, parser confidence, rationale, retrieved examples, duplicate candidates, audit). Edit category (allowlisted only), bounded payee/note, approve/exclude/return-to-review, create a balanced split (centavo-exact total, live remaining), re-categorize one unsplit item, bulk-approve preview/confirm (eligible only), and download a redacted **Review summary** CSV. All mutations are server-validated with revision checks; duplicate warnings are candidates, not facts; no row becomes approved without explicit action.
- Choose **Clear session** and confirm: the UI immediately removes all Phase 1–3 content (extractions, history summary, provider config, proposals, review items, audit, and export), the server clears in-memory session state and any encrypted workspace, and returns a 204 empty-session confirmation. Re-clearing is safe. Reloading or closing the page also sends a best-effort cleanup request for the active server session; refreshing never recovers previous result, history, or review state.

### Understanding extraction results

- **OCR is local and model-free.** Image statements, and PDFs without usable native text, are processed by the bundled Tesseract.js English OCR engine. Sharp prepares the page images and Tesseract recognizes their text in memory. No remote OCR service, generative model, or configured categorization provider participates in extraction, and OCR makes no runtime download.
- **The expense total is deterministic arithmetic.** Each accepted PHP amount is parsed from its decimal text into an integer number of centavos. Statement charges are represented as negative expenses; the displayed `Total (abs)` reconstructs and adds their absolute integer-centavo values, then converts the result to pesos for the API response. No model performs or verifies the summation, and the summation does not add floating-point peso values.
- **Extraction confidence is currently parser-assigned.** A BDO transaction that matches the required date/description/amount structure starts at `0.98` (displayed as `98%`). An attached installment continuation caps it at `0.92` (`92%`). Tesseract also produces a page-recognition confidence, but the current BDO parser does not propagate or combine that value into the transaction's displayed confidence. Consequently, `98%` is not a calibrated probability that every recognized character is correct; users should compare important descriptions and amounts with the source details.
- **Row status reports extraction issues.** `ok` means the accepted transaction has no row-level validation issues. `N issue(s)` means issues are attached to it; open the row's source details to inspect them. A successful import may also show a document-level validation summary. Errors such as a missing/invalid date or amount, malformed transaction-like row, unsupported currency/layout, or unreadable document cause safe rejection rather than a silently accepted transaction.
- **Excluded rows are not expenses in the total.** Recognized non-charge rows are retained for audit with one of four reasons: `previous-balance`, `credit-card-payment`, `summary`, or `other`. They contribute to the **Excluded** count but not the **Proposed** count or expense total.
- **Processing stages are separate from row status.** Internal ingestion progresses through `received`, `validated`, `extracting`, `parsing`, `normalizing`, and `complete`; terminal alternatives are `failed` and `cleared`. These stages describe the overall import lifecycle, whereas `ok`/`N issue(s)` describes an extracted row.

## Supported transport formats vs parser-backed layouts

Transport (validated at the ingestion boundary): CSV (RFC-style, BOM tolerated), PDF (native text vs scanned), and image files (JPEG/PNG/WebP/TIFF/BMP). Every extractor produces a neutral `DocumentPage`/`TextLine` representation.

Parser-backed layout at exit: `bdo-visa-gold-ph-image-v1` only — using the supplied three-page synthetic BDO Visa Gold PHP image fixture. Other routes (CSV, PDF text, or generic image) will reach the generic extractor but return `422 unsupported_layout` until a corresponding parser is backed by fixtures. Do not treat this as generic CSV/PDF support.

For recognized BDO images, the statement year and an opaque statement ID are
derived from the OCR-visible statement date. If that context is absent or
invalid, the import fails instead of borrowing a fixture year or the computer's
current year. Currency is PHP only; FX handling is not added.

## File limits and no-network guarantee

- **Per-file max:** 10 MiB (`MAX_FILE_SIZE_BYTES`) for statements; 5 MiB (`MAX_HISTORY_FILE_SIZE_BYTES`) for Wallet history.
- **Total upload max:** 30 MiB (`MAX_TOTAL_UPLOAD_BYTES`).
- **Page count:** 1 via `statement`, or 2–10 via `statementPages` (`MAX_PAGE_COUNT`, `MIN_PAGE_COUNT=2`).
- **History rows/fields:** at most 10,000 rows (`MAX_HISTORY_ROWS`), 5 MiB decoded text (`MAX_HISTORY_TEXT_LENGTH`), 500 chars per field (`MAX_HISTORY_FIELD_LENGTH`).
- **Text/OCR max:** 200,000 characters (`MAX_TEXT_LENGTH`); native PDF text is usable only above ~20 non-whitespace characters (`MIN_USABLE_NATIVE_TEXT_LENGTH`).
- **Scanned-PDF rendering:** at most 10 pages, 2,400-pixel render width, 25 MP per rendered page, 100 MP across the document, and a 100 MiB PDF.js decoded canvas/image bound.
- **Retrieval/proposals:** at most 5 retrieved examples per transaction (`MAX_RETRIEVED_EXAMPLES`); rationale ≤500 chars.
- **Provider:** request ≤64 KiB, response ≤64 KiB, 5 s timeout (`PROVIDER_TIMEOUT_MS`), no redirects, loopback-only URLs.
- **Classification confidence threshold:** 0.6 (`CLASSIFICATION_CONFIDENCE_THRESHOLD`); baseline confidence 0.95.
- Truncation is not silent: oversize, excess pages/characters, or decompression limits return `413`/`422` and create no active session/workspace.
- Ingestion, history import, parsing, OCR, retrieval, baseline, and provider validation have no network dependency and must not upload document bytes except for bounded, loopback-only provider calls (see “Local model provider”). The browser never puts bytes in URLs, `localStorage`/`sessionStorage`/`IndexedDB`, or logs. Privacy tests block external network during import, retrieval, baseline, and fake-local-provider classification and assert no outbound request.

## OCR prerequisites and fallback

Image routes use Tesseract.js 6 with the English language model installed as a
locked npm dependency. Sharp validates dimensions and prepares images entirely
in memory. OCR makes no runtime download and the integration test disables
network access while reading the actual three-page fixture. Parser and API unit
tests inject deterministic synthetic `TextLine` fixtures; this injection is not
available through a production environment switch.

Native-text PDF extraction uses the installed `PDFParse` class API. A PDF with
no usable native text is rendered into bounded in-memory PNG pages and passed
to the same local OCR interface; rendered pages are not written as plaintext
temporary files. Excess page, pixel, or decoded-memory limits fail safely
before parser/session storage.

If an encrypted workspace cannot be verified, processing stays in-memory for fixture-sized files and returns `413 document_too_large_for_memory_only_mode` for files over the safe memory limit (~5 MiB) — never falling back to plaintext files.

Temporary workspaces live under the OS temp root (`esoa-workspace/esoa-sess-<sessionId>`), with owner-only permissions, authenticated AES-256-GCM encryption and a fresh in-memory key per session, idempotent `clear(sessionId)`, stale-workspace recovery by prefix/age on startup, and cleanup on `SIGINT`/`SIGTERM`.

## Quality commands

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run eval          # reproducible baseline & fake-provider metrics from synthetic fixtures
npm run benchmark     # deterministic report from synthetic fixtures → docs/benchmarks/report.{json,md}
npm run test:e2e
npm run scan:secrets
npm run scan:repository
npm run scan:demo      # synthetic label + forbidden pattern guard
npm run scan:external  # no browser-side Wallet, no remote fonts/CDNs/telemetry
npm run audit
npm run build
```

Run the complete non-mutating project gate with:

```sh
npm run check
```

Use `npm run format` to apply formatting before rerunning the gate.

## Extension guides

- Parser authoring: `docs/guides/parser-authoring.md` — registry contract, normalization/exclusion/continuations, traceability, integer money/date rules, synthetic fixture provenance/allowlist, oracle construction, precision/recall, tests, safe rejection.
- Model provider authoring: `docs/guides/model-provider-authoring.md` — interface, loopback enforcement, bounded projection, schema validation, timeout/cancellation, test fake.
- Operations & troubleshooting: `docs/guides/operations-and-troubleshooting.md` — error-code recovery, Wallet initial-sync/rate-limit/mixed results, unknown-write policy.
- Benchmarks: `docs/benchmarks/README.md` — methodology, fixture limits, non-guarantee statement.

## Diagnostics & benchmarks

- Diagnostics: after any session exists, use **Preview diagnostics** (`GET /:id/diagnostics/preview`) then **Download diagnostics.json** (local file, not persisted). Content is redacted by default (versions, limits, parser/provider IDs, stage, safe issue codes, bounded counts/status counts) with manifest explaining omissions.
- Benchmarks: `npm run benchmark` is deterministic and synthetic-only; two runs on same revision yield identical correctness metrics/schema. See `docs/benchmarks/report.md` and `docs/benchmarks/README.md`. CI validates report sections/fixture counts.

## Accessibility & release

- A11y: semantic buttons/labels/table headers/form-error associations, focus transfer for dialogs/drawers (Escape closes), aria-live for async changes (bounded, no credentials), paired colours + icons, 320px + 200% zoom reflow (table → cards), `prefers-reduced-motion`. See `docs/benchmarks/accessibility-checklist.md`.
- Release: manual workflow in `docs/release/RELEASE.md` (clean-tree, `npm ci`, full check/audit/build, synthetic demo offline, a11y checklist, benchmark, dependency review, changelog/version review, tag, post-release clean-clone verification). Versioning is SemVer, `0.x` until stable contract declared (`CHANGELOG.md`, `LICENSE` MIT).

## Supported Wallet history schemas

The importer supports two exact, UTF-8 CSV schemas (BOM tolerated; header order may vary):

- Wallet-native comma- or semicolon-delimited exports with `account,category,currency,amount,ref_currency_amount,type,payment_type,note,date,transfer,payee,labels`. ISO timestamps are reduced to their calendar date without timezone conversion, whole/one-decimal amounts are normalized deterministically, descriptions use `note` then `payee` then `category`, and local deterministic record IDs are derived without persisting file contents.
- The supplied synthetic semicolon- or comma-delimited schema with `record_id,date,payee,description,amount,currency,category,account,source_row_id,note`.

Names must be unique and exactly match one supported set; unknown schemas fail safely with `history_schema_invalid` (no column guessing). Records require PHP currency, a valid ISO date, a parseable amount, and a non-empty category. Synthetic records additionally require a unique `record_id`, `YYYY-MM-DD` date, and two-decimal amount. The entire import is rejected for malformed parsing, missing or duplicate headers, invalid records, exceeded limits, or zero rows—partial history is not stored. Only a summary (record/category/account counts and adapter metadata) is returned; file bytes never appear in browser storage, URLs, logs, or repository paths.

## Local model provider

The provider-neutral interface from ADR-0003 is implemented; the first adapter targets a loopback OpenAI-compatible local endpoint (e.g., Ollama, LM Studio). Apple Intelligence remains a separate adapter until its local bridge and structured-output behavior are proven.

- **Configuration is active-session only:** `POST /api/session/:id/provider` stores `baseUrl` (and optional `model`) in memory; it is cleared with the session and never persisted if it contains credentials. No headers, tokens, or proxy settings are accepted.
- **Loopback enforcement (server-side, before connect):** URL must be `http(s)`, no credentials/fragment, host must be `127.0.0.1`/`::1`/`localhost` (or an IP literal that is loopback). For `localhost`, every resolved address is re-checked as loopback to mitigate DNS rebinding. Private/link-local/non-loopback, remote, credentialed, or redirected destinations are rejected. Redirects are disabled (`redirect: manual`).
- **Connection/privacy test:** `POST /api/session/:id/provider/test` calls the provider’s `GET /v1/models` with **no statement/history content**. It reports `reachable: true/false` and a non-sensitive model label; it never claims a provider is safe merely because it responded. The browser never contacts the provider directly.
- **Classification request (bounded, sanitized):** For each transaction, the server sends only: transaction projection (`description` ≤500, `amountMinor`, `date`, `payee` ≤200), bounded category allowlist (from the active history catalog plus `unknown`), bounded retrieved examples (≤5, each `historyRecordId`/`categoryName`/`description` ≤500/`payee` ≤200), and `schemaVersion`. No token, raw history file, filesystem path, full source excerpt, or arbitrary browser prompt is sent. Request ≤64 KiB, response ≤64 KiB, 5 s connect/read timeout, cancellation on session clear.
- **Response validation:** The provider must return schema-valid JSON `{ categoryName, confidence [0,1] finite, rationale 1..500, exampleIds[] subset of retrieved IDs }`. Allowlist membership and references are validated; nothing is clamped or repaired. `unknown`, low-confidence (`<0.6`), unavailable, or malformed results become `needs_review` with precise safe issue codes.

Start a local endpoint (example with Ollama):

```sh
ollama serve  # binds to 127.0.0.1:11434 by default
ollama pull llama3.2  # or any local model
# Configure in UI: Base URL http://127.0.0.1:11434, Model llama3.2, then Test local connection
```

## Categorization (baseline vs provider)

- **Retrieval:** Pure, in-process lexical retrieval over imported history. Normalization: Unicode NFKC, case-fold, collapse whitespace, conservative tokenization. Scoring signals (documented): exact normalized description (0.5), token overlap Jaccard (0.3), normalized payee match (0.15), amount similarity (0.1), recency (0.05), capped at 1.0. Tie-breakers: `score` desc → `date` desc → `recordId` asc. At most 5 examples per transaction; `source_row_id` is never a signal.
- **Catalog:** Built solely from validated history. Category identity is `trim` + collapsed whitespace + case-insensitive comparison; the canonical display spelling is retained. Ambiguous case/whitespace variants (e.g., `Shopping` vs `shopping`) are rejected rather than merged. Stable `categoryId` values are deterministic hashes of the normalized name and are not Wallet REST IDs.
- **Baseline classifier:** Proposes only when unambiguous: (1) exact normalized description with a single eligible category (`confidence 0.95`), or (2) top retrieval `score ≥0.9` with `margin ≥0.2`. Otherwise returns `unknown` (`confidence 0.3–0.4`, `needs_review`). Baseline output uses the same `CategoryProposal` schema as provider-assisted results.
- **Orchestration (`POST /api/session/:id/categorize`):** Requires active extraction and validated history; otherwise returns `history_not_imported`/`provider_not_configured`. For each row: retrieve examples → try baseline (use directly if high-confidence) → otherwise call the local provider → validate allowlist/references/confidence/rationale → apply `0.6` threshold → produce one `CategoryProposal` (`proposed`/`unknown`/`low_confidence`/`provider_unavailable`/`provider_malformed`, all `needs_review`) with bounded rationale and retrieval projection (raw model reply is discarded). Local-model inference is serialized and has a 120-second per-request timeout so model loading and prompt evaluation are not confused with an unavailable provider. Input order is preserved. The complete proposal set is committed atomically only if the `historyVersion` is still current; clearing/replacing history while a run is pending cancels/discards the result. Provider failure for one row does not abort other rows.

Proposals are advisory and **not approved** until Phase 3 explicitly changes `reviewState`.

## Review workspace (Phase 3)

- **Initialization:** `POST /api/session/:id/review/initialize` joins every extracted transaction to exactly one Phase 2 proposal (one-to-one) and runs deterministic duplicate detection. Replacing history or recategorizing invalidates review atomically; clear/shutdown removes it.
- **Review item:** `reviewItemId` (opaque), `kind` (`source`|`split`), `sourceRowId`, `amountMinor` (signed PHP centavos), `date`, `description` (bounded projection), optional `payee`/`note` (bounded), `categoryName` (must exactly match active-session catalog; `unknown` never approvable), `reviewState` (`needs_review`/`approved`/`excluded`), optional `exclusionReason`, immutable `proposal` evidence, `duplicateMatches`, `issues`, and server-issued `revision`.
- **Validation:** Category present and allowlisted before approval; `unknown`/low-confidence/provider failure remain review-required; exclusion reason required only for `excluded`; split children need category and centavo-exact total equals source amount; split parents are containers and never approvable; blocking parser errors prevent approval while duplicate warnings are non-blocking candidates.
- **Duplicate detection:** Exact key = canonical date + signed amount + normalized description + normalized reference when both present. Near-match score = amount (0.35) + date same/within1 (0.25/0.15) + description exact/token Jaccard (0.30) + reference (0.10), threshold >=0.80. Signals and thresholds are versioned server config (`DUPLICATE_VERSION 1.0.0`). No history or category is a signal.
- **Mutations (all server-validated, revision-checked `409` on conflict, audit-capped at 500):** edit category/payee/note (category edit → `needs_review`), approve one, exclude one (controlled reason), return to review, bulk approve (server-calculated eligible only; excludes warnings/errors, duplicates, unbalanced splits, unknown, non-needs_review), create/update/remove split (one level, at least two children, centavo-exact total, live remaining shown; parent locked).
- **Targeted re-categorization:** `POST /api/session/:id/review/:reviewItemId/reclassify` re-runs only that unsplit source item through Phase 2 retrieval/provider logic, preserves unrelated decisions, and returns it to `needs_review`. Split children are rejected with `reclassification_not_allowed`.
- **Export:** `GET /api/session/:id/review/summary-export` generates an in-memory CSV (`review-summary.csv`) with redacted columns `reviewItemId,sourceRowId,date,amountMinor,categoryName,reviewState,outcome,issueCodes,duplicateCandidateIds,kind,parentReviewItemId` plus aggregate counts; excludes raw excerpts, descriptions, payees, notes, references, history text, rationale, and provider data.
- **Handoff to Phase 4:** `ApprovedReviewItemForCommit` projection contains exactly approved, valid leaf items (no containers, no excluded/needs_review, no missing category, no invalid split total) with `reviewItemId,sourceRowId,date,amountMinor,currency,description,payee,note,categoryName,sourceReference,splitParentReviewItemId` preserved for dry-run/commit.

No Wallet token, account lookup, REST write, or cross-Wallet matching exists in Phase 3. “Commit-eligible” means review-approved and structurally valid, not that a Wallet destination has been selected.

## Synthetic fixtures

The reviewed BDO fixture set is under `fixtures/synthetic/bdo/`:

- Three approved synthetic statement images.
- `expected_extraction.csv`: the Phase 1 one-row-per-charge oracle, with 33
  included charges and four excluded statement rows.
- `wallet_records_synthetic.csv`: 35 post-review Wallet rows. Two source charges
  are intentionally split, and all rows reconcile to PHP 34,957.17.

Review fixtures are under `fixtures/synthetic/review/`:

- `duplicate_cases.json`: exact/near/non-duplicate pairs for detector tests.
- `split_cases.json`: centavo-exact and intentionally invalid split totals.
- `expected_summary.json`: expected review counts and post-split reconciliation (33 → 35, PHP 34,957.17).

Evaluation fixtures are under `fixtures/synthetic/evaluation/`:

- `cases.json`: 20 versioned, explicitly synthetic labeled cases (exact merchant repeats, similar descriptions with different categories, unseen merchants, installment text, fees, category ambiguity, malformed/unavailable provider simulations), each with input transaction, expected category or `unknown`, and an explanation. Labels are not derived from `source_row_id` at runtime.

All fixture values are synthetic. Real statements, screenshots, history
exports, OCR output, and tokens are ignored by default. Adding a new synthetic
fixture requires an explicit `.gitignore` allowlist entry and reviewer
confirmation of its provenance.

Run the reproducible evaluation (baseline and fake-provider) with:

```sh
npm run eval
# or directly: node --import tsx scripts/evaluate.mjs
```

It prints, at minimum: total cases, coverage (non-unknown proposal rate), precision among proposed, unknown rate, per-category support, low-confidence rate, malformed/unavailable rate, and a confidence-bucket calibration table. Zero-denominator cases are defined as `0`. The command is deterministic (fake provider) and is covered by unit tests that assert identical metrics on repeated runs.

## Architecture and privacy

The browser UI talks to a Node.js service bound to `127.0.0.1`. Document
parsers, OCR engines, local-model providers (via `src/server/categorization/`), review validation/duplicate detection (via `src/server/review/`), and the Wallet client are kept behind replaceable interfaces. HTTP routes → session/review service → validator/duplicate detector/audit → categorization service (targeted run) → history adapter / retriever / classifier → local provider adapter; the UI uses a typed API client. Session state (extractions, history bytes/records/catalog/retrieval index, provider config safe for display, prompts, raw model replies, proposals, review items, duplicate groups, audit events, and redacted summaries) is ephemeral and lives only in the active in-memory session (or the existing encrypted workspace when necessary); `clearAll()`/graceful shutdown/stale-workspace behavior removes it without a second cleanup action. Refreshing the browser does not restore history, provider config, proposals, or review decisions. There is no transaction database or cross-session learning cache.

Read [SECURITY.md](SECURITY.md) before handling a statement or credential. Key
architectural decisions are recorded in [docs/adr](docs/adr), and the complete
delivery plan is in [IMPLEMENTATION.md](IMPLEMENTATION.md). Phase 1 details are in [IMPLEMENT_phase1.md](IMPLEMENT_phase1.md), Phase 2 in [IMPLEMENT_phase2.md](IMPLEMENT_phase2.md), Phase 3 in [IMPLEMENT_phase3.md](IMPLEMENT_phase3.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never open an issue or pull request with
a real statement, Wallet export, prompt, token, OCR artifact, or screenshot of
financial data.

## Wallet integration (Phase 4)

Wallet REST is the first write integration (`https://rest.budgetbakers.com/wallet`, `Authorization: Bearer <token>`, pagination `limit`/`offset` max 200, `409` initial-sync, `429` with `Retry-After`, non-atomic per-`inputIndex` results, `207` mixed). A Wallet Premium user supplies an ephemeral token at runtime (password field, server-session only, never echoed/logged/exported, fixed HTTPS origin, `redirect: manual`, browser never contacts Wallet). After Phase 3 approval, the user selects one API-confirmed writable account, maps every distinct approved local `categoryName` to an eligible Wallet category, creates an immutable dry-run snapshot (count, signed total `amountMinor`, destination label, mapping coverage, records, split lineage, `Not sent yet`), explicitly confirms, and sees per-item outcomes: `succeeded` (Wallet ID), `client_error`, `server_error_retryable`, `unknown` (timeout/malformed/index mismatch — never auto-resent), `not_submitted`. Retry is server-selected only for `server_error_retryable`; `unknown` requires manual resolution; `409` halts writes; `429` exposes bounded cancellable wait; `wallet-import-results.csv` is redacted and active-session only.

OpenAPI sanitized fixture: `src/server/wallet/openapi.fixture.json` (version 2026-08-30) plus contract tests ensure adapter parity.

- REST reference: <https://rest.budgetbakers.com/wallet/reference>
- Wallet MCP endpoint: <https://mcp.wallet.budgetbakers.com>

## Troubleshooting (no sensitive diagnostics)

| Symptom                                                           | Safe code/stage          | Action                                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `history_schema_invalid` at `validated`                           | Header/parse error       | Ensure the CSV is semicolon-delimited, UTF-8, with exactly `record_id,date,payee,description,amount,currency,category,account,source_row_id,note` (order may vary) and quoted fields for embedded `;` or newlines. |
| `history_unsupported_currency`                                    | Currency not `PHP`       | History and statement must be `PHP` only; mixed currencies are rejected, not converted.                                                                                                                            |
| `history_duplicate_record_id` / `history_limit_exceeded`          | Limits/duplicate         | Check row count ≤10,000, file ≤5 MiB, field ≤500, and `record_id` uniqueness.                                                                                                                                      |
| `provider_malformed` at `validated`                               | Bad URL                  | Base URL must be `http(s)` loopback (`127.0.0.1`/`::1`/`localhost`); no credentials, fragment, private/non-loopback, or cloud host.                                                                                |
| `provider_not_configured` / `history_not_imported` at `validated` | Missing prerequisite     | Import history and save/test a local provider before categorizing.                                                                                                                                                 |
| `provider_unavailable` / `provider_malformed` per proposal        | Model failure            | Proposal is `needs_review`; check that the local endpoint is running (`ollama serve`), reachable at the configured loopback URL, and that the model is pulled. No statement data left the device.                  |
| `low_classification_confidence` / `unknown`                       | Low confidence           | Proposal is `needs_review`; use the bounded rationale and retrieved examples to review in Phase 3.                                                                                                                 |
| `clear_failed`                                                    | Clear path               | Retry clear; the server result is still available until `204` confirms removal.                                                                                                                                    |
| Stale history during categorize (`409 stale_history`)             | History replaced mid-run | History was replaced while categorizing; retry categorize with the new history version.                                                                                                                            |
