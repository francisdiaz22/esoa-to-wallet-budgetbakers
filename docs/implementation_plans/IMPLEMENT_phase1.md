# Phase 1 implementation runbook — statement ingestion and normalized extraction

## Purpose and completion boundary

Phase 1 converts a locally selected statement file into an in-memory,
traceable collection of validated canonical transactions. The first production
parser is deliberately narrow: `bdo-visa-gold-ph-image-v1`, using the supplied
three-page synthetic BDO Visa Gold PHP image fixture.

This phase ends at **extraction and display of proposals**. It does not import
Wallet history, call a model, classify, deduplicate, split transactions, save a
database, or make Wallet API calls. A row may be displayed as an extracted
record or an excluded source row; it is not a Phase 1 "approved" transaction.

Read this document together with [IMPLEMENTATION.md](IMPLEMENTATION.md),
[SECURITY.md](SECURITY.md), and ADRs 0001 and 0002 before making changes.

## Fixed decisions for this phase

| Concern          | Decision                                                                                                                                                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server boundary  | The browser sends selected bytes only to the existing loopback service. The service must stay bound to `127.0.0.1`/`localhost`.                                                                                                                    |
| Supported inputs | CSV, text-layer PDF, scanned PDF, and image files are accepted at the transport layer. Only the BDO image layout is parser-supported at exit. Other routes may reach a generic extractor but must fail clearly if no parser recognizes the result. |
| Initial parser   | `bdo-visa-gold-ph-image-v1`; statement ID is `BDO_VGOLD_202608` only for the supplied fixture/session metadata, never inferred from arbitrary layouts.                                                                                             |
| Currency         | PHP only. Reject or flag a detected currency that is not the configured session currency; do not add FX handling.                                                                                                                                  |
| BDO date         | Use **Sale Date**, never Post Date. Serialize as `YYYY-MM-DD`.                                                                                                                                                                                     |
| BDO amount       | A statement charge/fee is an expense: `amount` is negative PHP. Statement positive totals are reconciled with `Math.abs(amount)`.                                                                                                                  |
| BDO exclusions   | Do not propose `PAYMENT RECEIVED - THANK YOU`, `PREVIOUS STATEMENT BALANCE`, `SUBTOTAL`, or `TOTAL`. Preserve an excluded-source diagnostic so the user can understand the count difference.                                                       |
| Continuations    | Attach an `INSTALMENT n OF m` line to its preceding charge description. Attach a `Reference:` line to its preceding charge's `reference`/source metadata. Do not produce a transaction for either line.                                            |
| State lifetime   | Session state is in memory. Disk is allowed only for a necessary encrypted session workspace. Clear it on explicit clear, graceful shutdown, and stale-workspace recovery.                                                                         |
| Network          | Ingestion, parsing, OCR, and validation have no network dependency and must not upload document bytes.                                                                                                                                             |

## Definition of the user-visible flow

1. The user opens the local UI and sees an import control plus a concise local
   processing notice.
2. They drag a document (or its ordered image pages) onto the drop zone or
   select it with the file picker.
3. The UI performs basic client-side checks and submits the document/pages to
   the loopback API using `multipart/form-data`; it must not put bytes in a URL,
   localStorage, sessionStorage, IndexedDB, or logs.
4. The API validates size/type/content signature, creates/uses one active
   session, selects extraction routing, and returns a structured result. The
   UI renders progress while the request is pending.
5. If the BDO layout is recognized, the UI shows 33 canonical rows for the
   supplied fixture, a count/amount summary, validation status, and a
   source-detail affordance for every row.
6. Unsupported, malformed, encrypted, or unreadable inputs show a safe,
   actionable error: format detected, stage that failed, and next action. They
   must not show raw document contents, stack traces, filesystem paths, or
   misleading partial transactions.
7. The user can choose **Clear session**. The UI immediately removes results;
   the server removes session state and any workspace, then returns an empty
   session confirmation. Repeating clear is safe.

Phase 1 needs a compact extraction-results screen, not the Phase 3 review
table. It should use an accessible native file input behind the styled drop
zone, a keyboard-operable source-details control, and a screen-reader-visible
status/error region.

## Work packages and dependency order

Implement in this order. A change may span packages, but do not start a later
package by inventing contracts the earlier package has not defined.

## Progress tracker — updated 2026-08-29

Legend: **Complete** means the current implementation and relevant automated
checks satisfy the package outcome. **Partial** means useful implementation is
present, but at least one stated exit condition remains open.

| Package | Status   | Completed work                                                                                                                     | Remaining work |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| P1.1    | Complete | Runtime contracts, deterministic decimal handling, MIME/file/text/page limits, and boundary tests are implemented.                 | —              |
| P1.2    | Complete | In-memory sessions, opaque IDs, encrypted owned workspaces, idempotent clear, stale cleanup, and shutdown cleanup are implemented. | —              |
| P1.3    | Complete | Multipart validation; CSV/native-PDF/image routing; bounded scanned-PDF rendering; and stable safe errors are implemented.         | —              |
| P1.4    | Complete | Extractor/parser/OCR interfaces, offline Tesseract OCR, and bounded in-memory scanned-PDF rasterization are tested.                | —              |
| P1.5    | Complete | BDO parsing and genuine OCR match every oracle row using conservative, layout-independent OCR artifact repair.                     | —              |
| P1.6    | Complete | Invalid output fails closed, centavo-safe totals reconcile, and suspicious balances remain visible with warnings.                  | —              |
| P1.7    | Complete | Accessible UI states/details/clear are covered by component tests and a real-Chrome import/details/clear E2E test.                 | —              |
| P1.8    | Complete | Documentation, privacy coverage, 46 Vitest tests, Chrome E2E, scans, audit, build, and clean-install verification pass.            | —              |

Current exit-criteria count: **11 complete / 11 total**. Phase 1 is
**complete**.

### P1.1 — Lock contracts, dependencies, and safe limits

**Outcome:** Pure TypeScript contracts and boundary schemas exist before HTTP,
OCR, or UI code relies on them.

Create a server-side feature area such as `src/server/ingestion/`; keep imports
one-directional:

```text
HTTP route -> session service -> router -> extractor -> parser -> normalizer/validator
                              \-> workspace service
UI --------> typed API client ----------------------------------------------^
```

Define and validate at boundaries (Zod or an equivalent runtime schema; add the
dependency rather than relying on TypeScript types alone):

```ts
type SourceFormat = 'csv' | 'pdf-text' | 'ocr';
type IngestionStage =
  | 'received'
  | 'validated'
  | 'extracting'
  | 'parsing'
  | 'normalizing'
  | 'complete'
  | 'failed'
  | 'cleared';

type Issue = {
  code:
    | 'missing_date'
    | 'missing_amount'
    | 'invalid_decimal'
    | 'suspicious_balance'
    | 'malformed_row'
    | 'unsupported_layout'
    | 'unsupported_currency'
    | 'unreadable_document';
  severity: 'info' | 'warning' | 'error';
  message: string;
  relatedSourceRowIds?: string[];
};

type SourceLocation = {
  format: SourceFormat;
  bankParserId: string;
  page?: number; // 1-based when document/page based
  row?: number; // 1-based source-row/order where known
  rawText: string; // minimum excerpt required to justify this row
};

type ExtractedTransaction = {
  sourceRowId: string;
  statementId: string;
  date: string;
  description: string;
  amount: number;
  currency: 'PHP';
  balance?: number;
  reference?: string;
  source: SourceLocation;
  extractionConfidence: number; // finite number in [0, 1]
  issues: Issue[];
};

type ExcludedSourceRow = {
  sourceRowId: string;
  page?: number;
  rawText: string;
  exclusionReason:
    'previous-balance' | 'credit-card-payment' | 'summary' | 'other';
};

type ExtractionResult = {
  sessionId: string; // opaque random ID; never derived from document data
  parserId: string;
  statementId?: string;
  sourceFormat: SourceFormat;
  transactions: ExtractedTransaction[];
  excludedRows: ExcludedSourceRow[];
  issues: Issue[];
  summary: {
    proposedCount: number;
    excludedCount: number;
    expenseTotal: number;
  };
};
```

Rules:

- Do not model money as a floating-point business value internally. Parse a
  decimal string with a deterministic decimal/minor-unit helper, validate to
  two PHP fraction digits, then expose the API number only at the final
  response boundary. Tests must cover `0.10 + 0.20` behavior and totals.
- Trim/collapse repeated whitespace in normalized descriptions, but retain the
  source excerpt unchanged enough to audit the parse.
- `sourceRowId` identifies a source charge/row, not a generated array index.
  Use deterministic IDs such as the oracle IDs for the BDO fixture.
- Limit raw source excerpts returned to the excerpt needed for traceability;
  they are sensitive active-session data. Never place them in `Error.message`,
  browser console output, server logging, or test snapshots.
- Establish named constants for supported MIME types, a conservative maximum
  file size, max page count, and max OCR/text length. The implementing agent
  must document chosen values and test each boundary. Do not silently truncate
  bytes or text and continue parsing.

**Done when:** contracts compile; valid and invalid JSON/file-metadata boundary
tests exist; there is no `any`/unchecked request-body cast in the new API path.

### P1.2 — Session lifecycle and encrypted temporary workspace

**Outcome:** Upload processing is bounded and cleanable without creating a
transaction database or leaving plaintext financial artifacts behind.

Implement a `SessionStore` that keeps the active `ExtractionResult`, input
metadata, and cleanup handles in memory. Use opaque random session IDs. The
server owns the session; the browser receives only an ID required for the
active interaction. Do not use cookie persistence or browser storage.

Create a `TemporaryWorkspace` abstraction, even if the initial image adapter
can process buffers in memory and does not need disk. Its implementation must:

- create a per-session directory under the ignored temporary root, with
  restrictive owner-only permissions;
- encrypt any document/OCR intermediate written to disk using authenticated
  encryption and a fresh, in-memory-only key per workspace;
- retain no key, plaintext, raw OCR, or document bytes after `clear()` or
  graceful shutdown;
- use file handles/explicit paths owned by the workspace only; never accept a
  user-supplied path for deletion;
- attempt stale workspace removal on startup using an explicit prefix and age
  policy, without traversing arbitrary directories; a failure is logged only as
  a non-sensitive operational event;
- expose `clear(sessionId)` as idempotent and call it from `SIGINT` and
  `SIGTERM` shutdown handling before closing the server.

If a cross-platform encrypted workspace cannot be implemented and verified in
this phase, keep all fixture-sized processing strictly in memory and return a
clear `document_too_large_for_memory_only_mode` error for files over the safe
in-memory limit. Do **not** fall back to plaintext files. Record this temporary
constraint in the PR/implementation notes.

**Done when:** clear/shutdown/stale-cleanup tests prove only the owned test
workspace is removed; normal server tests have no retained session after clear;
no runtime path writes plaintext statement/OCR data to the repository,
`uploads/`, `tmp/`, or the OS temp root outside the workspace abstraction.

### P1.3 — Upload endpoint, file validation, and routing

**Outcome:** A single safe API flow accepts an input and deterministically picks
an extraction strategy.

Add endpoints under `/api/session` (the exact path may vary only if all tests
and client references stay aligned):

| Method/path                       | Request                                                                                                              | Success                       | Required failure behavior                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/session/import`        | Either one `statement` multipart file or an ordered `statementPages` image set; optional declared statement metadata | `201` plus `ExtractionResult` | `400` bad/missing input; `413` limit exceeded; `415` unsupported file/signature; `422` readable but unsupported layout/invalid extraction. Responses use stable error codes, safe message, stage, and request ID. |
| `GET /api/session/:id/extraction` | Opaque session ID                                                                                                    | `200` result                  | `404` unknown/cleared session, without revealing other session state.                                                                                                                                             |
| `DELETE /api/session/:id`         | Opaque session ID                                                                                                    | `204` after idempotent clear  | `204` for an already-cleared/unknown caller-owned ID is acceptable; do not leak existence.                                                                                                                        |

Use a multipart parser with explicit file-count, size, and field limits. One
request is one statement: it may contain exactly one PDF/CSV/image in
`statement`, or 2–10 images in `statementPages` in user-selected order;
mixing the two field names is invalid. The BDO fixture flow uses the latter.
Persist neither original filenames nor file paths in the result. Do not add a
catch-all body parser that buffers arbitrary uploads. Reject:

- zero-byte files, more than one statement, oversize inputs, path-like
  filenames, and declared MIME types that disagree with magic bytes;
- extension/signature combinations outside the supported set;
- password-protected/encrypted PDFs with an explicit `encrypted_pdf` code;
- image/PDF files that exceed page/pixel/decompression limits before OCR.

Format detection is based on signature/content, with the extension only as a
hint. Route in this order:

1. RFC-style CSV (BOM tolerated): CSV extractor.
2. PDF with usable native text: text-PDF extractor.
3. PDF without usable text: render pages locally then OCR them.
4. Supported image signature: OCR it.
5. Anything else: `415 unsupported_file_type`.

"Usable native text" means the document yields non-whitespace text above a
small documented threshold after extraction; it does not mean an arbitrary PDF
can be treated as BDO. Every extractor produces a neutral `DocumentPage` /
`TextLine` representation with page, line/order, text, and confidence where
available. Parser detection operates on that representation.

The initial implementation may return `422 unsupported_layout` for successful
CSV/text-PDF extraction because no corresponding parser is backed by fixtures
yet. This satisfies format ingestion without pretending format support.

**Done when:** the endpoint has request/response schema tests, MIME/signature
mismatch tests, size/zero/multiple-file tests, and route-selection tests. A
failure never triggers a network request, returns source content in its error,
or leaves an active session/workspace.

### P1.4 — Extractor interfaces and local OCR adapter

**Outcome:** Input conversion is replaceable and parser logic never manipulates
HTTP files or shell commands.

Define interfaces roughly as follows:

```ts
interface DocumentExtractor {
  readonly id: string;
  supports(input: ValidatedInput): boolean;
  extract(
    input: ValidatedInput,
    workspace: TemporaryWorkspace,
  ): Promise<ExtractedDocument>;
}

interface BankParser {
  readonly id: string;
  canParse(document: ExtractedDocument): ParserMatch;
  parse(document: ExtractedDocument, context: ParserContext): ParsedStatement;
}
```

`ParserMatch` must give a score/reason and have a documented threshold. The
registry selects one parser only when there is a single confident match; ties
or below-threshold matches return `unsupported_layout`, never a guessed parser.

Use a local, pinned OCR implementation suitable for Node/cross-platform use.
Its data path must remain local. Inject it behind an `OcrEngine` interface so
tests provide deterministic `TextLine` fixtures rather than invoking OCR. Pin
the language/model assets and document their install/runtime behavior; do not
download language data automatically during statement processing. If the chosen
engine needs a native binary, validate its executable/version at startup and
return a safe `ocr_unavailable` error when missing.

The image adapter must preserve page number and reading order. Before parser
development, create a checked-in synthetic OCR transcription/line fixture only
if it is allowlisted in `.gitignore` and clearly marked synthetic; otherwise
generate it inside tests from safe in-memory literals. Never commit output from
a real statement.

**Done when:** the registry is unit tested for recognized, unrecognized, and
ambiguous layouts; parser unit tests do not depend on a native OCR installation;
the integration test uses the supplied image files and the selected local OCR
adapter when the documented optional prerequisite is available.

### P1.5 — Implement `bdo-visa-gold-ph-image-v1`

**Outcome:** The first layout produces the exact canonical set defined by the
oracle, with evidence for every decision.

Implement parser detection using stable BDO layout anchors (header/column
labels and expected transaction structure), not account/card numbers,
statement dates, or merchant names. Do not hard-code the fixture filename or
the 33 merchant strings as parsing logic.

Parse source lines in reading order. The state machine needs these cases:

1. Recognize a new transaction row containing a sale date, transaction text,
   and an amount. Preserve its source line/order and page.
2. For a following `INSTALMENT n OF m` continuation, append ` | INSTALMENT n OF
m` to the immediately preceding eligible transaction description. If it has
   no preceding transaction, produce a `malformed_row` warning rather than
   attaching it elsewhere.
3. For a following `Reference:` continuation, normalize the reference into the
   preceding transaction's `reference` field and retain the line in raw source
   evidence. Orphaned references produce `malformed_row`.
4. Recognize the four exclusion categories case/spacing-insensitively and put
   them in `excludedRows`, retaining source ID/page/excerpt/reason.
5. Treat a charge or fee as a proposed negative amount. Do not treat a payment
   as a negative expense; it is excluded.
6. Assign deterministic fixture source IDs (`p1-r001` … `p3-r033`, and
   excluded `p1-x001`, `p2-x002`, `p3-x003`, `p3-x004`) by source order for the
   supplied fixture. For a general recognized BDO statement, use an equally
   deterministic page + source-order ID scheme; it cannot depend on OCR array
   accidentals.

`rawText` for an included transaction must include enough of the original
transaction line and attached continuation/reference line to explain the
normalized result. The parser must never fabricate dates, amounts, references,
or descriptions to satisfy the oracle.

Implement normalizers as pure, focused functions and test them independently:

- `parseBdoSaleDate`: rejects impossible/ambiguous dates and produces ISO
  dates using the statement year supplied by parsed statement context (not the
  current computer year).
- `parsePhpAmount`: accepts documented thousands/decimal presentation; rejects
  malformed decimal precision and accounting/credit notation until explicitly
  supported.
- `normalizeDescription`: whitespace normalization only; preserves merchant
  meaning and installment text.
- `normalizeReference`: strips the `Reference:` label and rejects empty values.
- `toExpenseAmount`: returns a negative minor-unit-safe amount.
- `classifyExcludedBdoRow`: returns only the four agreed reasons.

Set `extractionConfidence` based on observable parser evidence, not a hard-coded
blanket `1`. A fully structured recognized row can be high confidence; OCR
ambiguity, missing optional reference, or a recoverable oddity should lower it
and/or add an issue. Do not make confidence a substitute for errors: rows with
missing date/amount are invalid and must not be silently proposed.

**Done when:** the parser passes the oracle comparison and all edge-case unit
tests in the test matrix below. It must be possible to identify the original
page and raw source excerpt for every proposed/excluded row.

### P1.6 — Validation, reconciliation, and result assembly

**Outcome:** A parser result cannot cross the API boundary unless it is
structurally valid, traceable, and internally reconciled.

Run validation after normalization and before session storage. Apply at least:

| Rule                                                               | Required result                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Missing/invalid ISO date                                           | `error: missing_date`; do not return it as a valid proposed transaction.                            |
| Missing/non-finite/invalid decimal amount                          | `error: missing_amount` or `invalid_decimal`; do not return it as valid.                            |
| Empty description after normalization                              | `error: malformed_row`; no valid proposal.                                                          |
| Currency differs from configured PHP                               | `error: unsupported_currency`; do not mix currencies.                                               |
| Duplicate `sourceRowId`                                            | Parser/result error; fail the import rather than overwrite.                                         |
| Missing parser ID/page/excerpt where the source has one            | Parser/result error.                                                                                |
| Balance present but internally suspicious                          | Preserve the record and attach `warning: suspicious_balance`; never invent a reconciliation.        |
| Excluded/valid source count differs from recognized candidate rows | Result-level warning or fail-safe error with an explicit count; never silently discard a candidate. |

For the supplied BDO fixture, assert reconciliation at import completion:

- 37 recognized source rows = 33 proposed + 4 excluded;
- proposed PHP absolute-value total is `34,957.17` exactly in minor units;
- all proposed amounts are negative and all currencies are PHP;
- source IDs, source order, page, sale date, description, amounts, and
  references exactly match `expected_extraction.csv` for its included/excluded
  semantics.

Do not compare output only by an unordered totals check: it can hide a swapped,
missing, or duplicated transaction. Compare row identity and every required
field, then totals.

**Done when:** result assembly rejects invalid parser output in tests, all
fixture reconciliation assertions run through the same public service used by
the UI, and neither client nor server needs to reinterpret parser fields.

### P1.7 — Client import and extraction-results UI

**Outcome:** The feature is usable and reveals both data and uncertainty without
starting Phase 3 review work.

Replace the Phase 0-only screen with an import screen that includes:

- a labelled file picker and drag/drop target; accepted type hints are helpful
  but browser hints are not validation;
- a plain local-processing statement: files are processed by the service on
  this device and cleared on request; no claim of persistent encrypted storage
  unless P1.2 actually implements it;
- selected-file name/size only (do not render local path or preview sensitive
  full images by default), pending/progress/error/success states, and disabled
  duplicate submission;
- results summary: parser ID, source format, proposed/excluded counts, and
  absolute PHP expense total;
- a responsive, keyboard-accessible results table: date, description, amount,
  source page/row, confidence, and issue status;
- an expandable/dialog source-detail view that exposes page, row, parser ID,
  raw excerpt, reference, and validation issues for the selected row;
- a clear-session action with confirmation appropriate to destructive loss of
  current results. On confirmed success, remove all result state from React
  memory and return to the empty import screen.

Use a small typed API client. Handle non-2xx responses as the stable server
error envelope, not generic `Error` strings. Avoid putting data-rich errors in
the console. Do not use client-side OCR, browser persistence, categories,
approval controls, "commit" wording, or Wallet integration in this phase.

**Done when:** component tests cover keyboard selection, pending/error/empty/
success/clear states; an E2E test can import a synthetic fixture, inspect a
source detail, and clear it without a page reload.

### P1.8 — Documentation, scripts, and review readiness

**Outcome:** A future agent/contributor can reproduce and extend Phase 1
without processing personal financial data.

Update the main README when the feature lands:

- change status from Phase 0 to Phase 1 only after every exit criterion passes;
- list supported transport formats separately from parser-backed layouts;
- document prerequisites for optional local OCR and the in-memory safe fallback;
- document the import and clear-session behavior, file limits, and no-network
  guarantee;
- retain synthetic-fixtures-only guidance.

Add any needed npm scripts for E2E/integration tests and make CI run them when
their dependencies are available. Add no secret, real statement, OCR output,
or generated screenshots. Update `.gitignore` only with narrowly reviewed
synthetic-fixture allowlists.

## Test matrix

Tests are a deliverable, not a follow-up. Keep unit tests near modules and use
fixture/integration/E2E tests where their behavior crosses a real boundary.

| Layer                | Cases required before merge                                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract/unit        | Runtime schemas accept a valid canonical row and reject every required field violation; decimal parser/formatter preserves centavos; date, description, reference, exclusion, issue, source-ID, and confidence functions cover happy and boundary cases.                                                                               |
| Parser/unit          | New row; multi-page row order; installment continuation; reference continuation; orphan continuation/reference; each exclusion; payment sign; malformed date/amount; ambiguous OCR token; missing evidence; parser detection below threshold and ambiguous registry match.                                                             |
| Fixture/integration  | Import all three supplied BDO images through the public import service. Assert exactly 33 proposed, 4 excluded, PHP `34,957.17`, all negative proposed amounts, exact row-by-row oracle agreement, correct page/source IDs, and no invalid-row warnings.                                                                               |
| OCR integration      | Run the selected local OCR adapter against the supplied synthetic images in an environment with its documented dependency. Check its lines retain enough order/evidence for parser success. Mark this test as an explicit prerequisite, not a silently skipped default test.                                                           |
| File/API integration | Multipart success; each allowed signature; extension/MIME mismatch; zero/oversize/multiple file; malformed CSV; text PDF route; scanned PDF/OCR route; image route; encrypted PDF; unknown type; unsupported readable layout; no-session/cleared-session GET; repeated DELETE. Assert status, stable code, safe envelope, and cleanup. |
| Session/workspace    | Session isolation, imports do not overwrite another active session, clear is idempotent, cleanup on normal shutdown, stale-owned-workspace cleanup only, and no plaintext temporary artifact remains after success/failure/clear.                                                                                                      |
| UI                   | File picker and drag/drop are keyboard accessible; ARIA live status; pending prevents duplicate import; safe server error appears; 33-row fixture result summary/table; details shows source evidence; clear returns to empty state and hides data.                                                                                    |
| Privacy/regression   | Network is blocked/spied during an import and no request occurs; logs are captured to prove no raw excerpt/token/file bytes; repository and secret scans still pass; a test proves no browser persistence API is invoked by this feature.                                                                                              |

### Oracle comparison procedure

Use `fixtures/synthetic/bdo/expected_extraction.csv` as the Phase 1 oracle,
not `wallet_records_synthetic.csv`. The latter has 35 post-review records and
two intentional splits, which are explicitly out of scope.

For each oracle row:

- `include=true`: find exactly one result by `source_row_id`, compare page,
  ISO sale date, normalized description, raw amount after deterministic
  parsing, signed amount, currency, and reference. Compare source excerpt and
  parser ID for presence/correct mapping rather than brittle whole-OCR text.
- `include=false`: find exactly one `excludedRows` entry with correct source ID,
  page, raw evidence, and mapped exclusion reason.
- Assert no additional proposed/excluded source IDs exist.

The row-level score is `correct included rows / expected included rows` for
precision and recall, with a row correct only when all required fields match.
For the supplied fixture the hard gate is 33/33 precision and 33/33 recall
(100%). The general Phase 1 quality floor remains at least 97% precision and
recall for future OCR fixtures, but no 97% rounding is allowed to excuse a
known mismatch in this baseline.

## Commands and verification sequence

From the repository root, run the following after implementation. Add an E2E
command to this list if the project adopts Playwright or an equivalent runner.

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run scan:secrets
npm run scan:repository
npm run audit
npm run build
```

Manual smoke verification (synthetic fixture only):

1. Run `npm run dev`; confirm the browser and API bind to loopback.
2. Import `fixtures/synthetic/bdo/statement_page_1.jpg` only. It must either
   report an incomplete/unsupported statement safely or, if single-page BDO
   support is deliberately implemented, report only rows evidenced by that
   page—never invent pages 2–3.
3. Select the three images in ascending page order in the documented ordered
   `statementPages` flow. Confirm 33 proposals, 4 excluded,
   total PHP 34,957.17, and inspect one page-1, page-2, and page-3 source
   detail.
4. Attempt an unsupported file and confirm a safe diagnostic without an upload
   to a remote host.
5. Clear the session, refresh the browser, and verify no previous result is
   recoverable. Inspect the configured workspace only through test tooling to
   confirm cleanup, never by exposing its contents in app logs.

## Explicit exit criteria

Phase 1 is complete only when every item below is true:

- [x] The import UI supports accessible picker and drag/drop, safe progress and
      error states, result summary/table, source details, and explicit clear.
- [x] Server-side validation and content-based routing support CSV, PDF, and
      image inputs at the ingestion boundary; unsupported readable layouts fail
      clearly and safely.
- [x] Extraction/OCR/parser/workspace/session logic is behind interfaces; UI
      and HTTP handlers contain no BDO parsing rules.
- [x] `bdo-visa-gold-ph-image-v1` recognizes the supplied synthetic layout
      without filename, merchant, account, or date hard-coding.
- [x] The three-page fixture import exactly matches all 33 included oracle rows
      and all 4 exclusions, including sale dates, negative PHP amounts,
      descriptions/continuations, references, source IDs/pages, and total
      PHP 34,957.17.
- [x] Every proposed row has parser ID, source format, source location, raw
      excerpt, finite `[0,1]` confidence, and a validation result.
- [x] Invalid/malformed candidates cannot silently appear as valid proposed
      transactions. Missing date/amount and invalid money generate the required
      errors; suspicious balance generates a visible warning.
- [x] Statement bytes/OCR artifacts are never sent over the network, saved in
      browser persistence, written as plaintext temporary files, logged, or
      committed. Session clear, graceful shutdown, and stale-workspace cleanup
      are tested.
- [x] No transaction categorization, approval, splitting, duplicate decision,
      Wallet history import, token entry, or Wallet API call has been added.
- [x] All commands in the verification sequence pass from a clean install, and
      new tests pass deterministically without a real statement or credential.
- [x] README status and usage/security documentation describe the actual
      delivered behavior and limitations.

## Out of scope guardrails

If an implementation task starts to require any item below, stop and create a
separate decision/task rather than smuggling it into Phase 1:

- supporting an unfixture-backed bank/layout or claiming a generic CSV/PDF
  parser is production-ready;
- cloud OCR, hosted storage, telemetry, remote diagnostics, or a hosted LLM;
- persisting a statement, extraction result, history, or categories beyond the
  active session;
- selecting Wallet accounts/categories, categorizing, approving, splitting,
  matching Wallet records, or sending a Wallet write;
- accepting multi-currency statements, FX conversion, transfer reconciliation,
  automatic duplicate removal, or automated bookkeeping decisions;
- loosening privacy controls just to make an OCR library, test, or demo work.

## Handoff checklist for the next implementation agent

Before coding, the agent should report: selected OCR/PDF/multipart libraries
and their local-data behavior; exact input/page/size limits; whether the
encrypted workspace is implemented or memory-only fallback is used; and the
test command that exercises actual OCR. Those implementation choices remain
open, but each must be made explicitly, documented, and covered by the exit
criteria above. The multi-page API/UI shape is fixed: use the ordered
`statementPages` field described in P1.3.
