# Phase 2 implementation runbook — Wallet history import and local categorization

## Purpose and completion boundary

Phase 2 turns Phase 1 extracted transactions into **auditable category
proposals** using Wallet history imported for the active session and a
user-selected local model runtime. It establishes the data contracts,
deterministic retrieval, provider boundary, fallback behavior, and repeatable
evaluation needed before Phase 3 adds editing and approval workflows.

At the end of this phase, every extracted transaction has one of these
classification outcomes:

- a validated category proposal with confidence, concise rationale, and local
  history examples that support it;
- a deterministic baseline proposal when that is more appropriate than calling
  a model; or
- an explicit `unknown`/unavailable/malformed/low-confidence result marked
  `needs_review`.

This phase does **not** add duplicate detection, transaction splitting, a full
HITL approval table, transaction edits, Wallet account selection, API tokens,
or Wallet REST writes. Those are Phase 3 and Phase 4 work. Imported history,
prompts, model responses, retrieval indexes, and proposals remain active
session data only; no transaction database or cross-session learning cache is
introduced.

Read this document together with [IMPLEMENTATION.md](IMPLEMENTATION.md),
[IMPLEMENT_phase1.md](IMPLEMENT_phase1.md), [SECURITY.md](../../SECURITY.md),
and [ADR-0003](../adr/0003-provider-neutral-local-model-interface.md) before
making changes.

## Fixed decisions for this phase

| Concern            | Decision                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input boundary     | Wallet history is imported through the loopback service as a session-scoped file. The first supported schema is the supplied synthetic semicolon-delimited CSV (`record_id,date,payee,description,amount,currency,category,account,source_row_id,note`). Unknown schemas fail safely; do not guess columns. |
| Currency           | PHP only. Every valid history record and every classification input must use `PHP`; mixed/unsupported currencies are rejected rather than converted.                                                                                                                                                        |
| Category authority | Only non-empty category names found in the validated active-session history are eligible outputs. The reserved `unknown` outcome is always allowed and is never silently mapped to a Wallet category.                                                                                                       |
| Model runtime      | Implement the provider-neutral interface from ADR-0003. The first production adapter targets a loopback OpenAI-compatible local endpoint. Apple Intelligence remains a separate adapter until its supported local bridge and structured-output behavior are proven.                                         |
| Network boundary   | Provider base URLs must resolve to loopback addresses only (`127.0.0.1`, `::1`, or `localhost` resolved and rechecked as loopback). No cloud URL, proxy, redirect, telemetry, or runtime model download is permitted.                                                                                       |
| Retrieval          | Use deterministic, in-process lexical retrieval over the imported history. Do not add a vector database, embedding API, persistent index, or remote reranker.                                                                                                                                               |
| Model authority    | Model output is advisory. Runtime schema validation, category allowlisting, confidence thresholds, and input/output limits decide the final outcome. Invalid output never becomes a proposal.                                                                                                               |
| State lifetime     | History bytes, parsed records, category catalog, retrieval index, prompts, raw model replies, and classification results belong only to the active in-memory session (or the existing encrypted workspace when necessary). Clear/shutdown removes them with the Phase 1 session.                            |
| UI boundary        | Phase 2 adds import, runtime setup/test, categorization status, and a compact proposal summary. It may show a read-only result list, but it must not pre-empt Phase 3 by adding approval, exclusion, split, duplicate, or commit controls.                                                                  |

## User-visible flow

1. After statement extraction succeeds, the UI invites the user to import a
   Wallet history file and explains that it is used only in the current local
   session.
2. The user selects the supported history CSV. The app validates it, reports a
   safe error or a summary (record count, category count, and accounts found),
   and never renders raw history records in an error message.
3. The user chooses/configures a local runtime and runs a connection/privacy
   test. The UI identifies a reachable local provider without exposing model
   prompts, endpoints containing credentials, or raw responses.
4. The user starts categorization. The service retrieves the most relevant
   local examples deterministically for each source transaction, optionally
   calls the local provider, validates the response, and stores only the
   sanitized proposal evidence required for the active session.
5. The UI shows proposed category, confidence, a brief rationale, outcome, and
   a `needs review` indicator. Unknown, unavailable, malformed, and
   low-confidence outcomes are visually distinct and remain unapproved.
6. **Clear session** removes extracted results and every Phase 2 artifact.
   Refreshing the browser does not restore history, provider configuration,
   prompts, or proposals.

## Dependency order

Implement packages in order. Later packages may use the explicit contracts of
earlier packages, but must not create an undocumented parallel session store or
provider contract.

```text
P2.1 contracts and session extension
  -> P2.2 history import and schema adapter
  -> P2.3 catalog, normalization, and deterministic retrieval
  -> P2.4 local-provider adapter and connection/privacy test
  -> P2.5 classification orchestration and fallbacks
  -> P2.6 client flow and accessible status presentation
  -> P2.7 synthetic evaluation, privacy verification, and documentation
```

## Progress tracker — updated 2026-08-30

Legend: **Complete** means the current implementation and relevant automated checks satisfy the package outcome. **Partial** means useful implementation is present, but at least one stated exit condition remains open.

| Package | Status   | Completed work                                                                                                                                                                                                                       | Remaining work |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| P2.1    | Complete | Runtime contracts (`WalletHistoryRecord`, `CategoryCatalogEntry`, `RetrievedExample`, `CategoryProposal`), extended `SessionStore` Phase 2 state, expanded issue codes, limits, and clear/shutdown tests are implemented.            | —              |
| P2.2    | Complete | Bounded Wallet-history import (`POST /api/session/:id/history/import`) with BOM/quoted handling, strict header/row/limit validation, atomic replace, and safe summary is implemented.                                                | —              |
| P2.3    | Complete | Category catalog (case/whitespace normalization, ambiguous rejection, stable IDs), deterministic lexical retrieval (exact, token overlap, payee, amount, recency, tie-breakers), and baseline classifier are implemented and tested. | —              |
| P2.4    | Complete | Provider-neutral interface and loopback OpenAI-compatible adapter with loopback/DNS-rebinding, redirect, timeout, and size guards plus connection/privacy test are implemented.                                                      | —              |
| P2.5    | Complete | Orchestration with baseline-first, bounded provider calls, allowlist/reference validation, confidence threshold, atomic versioned commit, bounded concurrency, and per-row fallbacks is implemented.                                 | —              |
| P2.6    | Complete | Accessible Phase 2 UI (history import, provider config/test, categorize, read-only proposal summary, pending/error states, immediate clear) is implemented and covered by component and E2E tests.                                   | —              |
| P2.7    | Complete | Synthetic evaluation harness (20 cases, metrics, buckets, zero-denominator), privacy checks, and README/troubleshooting documentation are implemented and reproducible.                                                              | —              |

Current exit-criteria count: **all packages complete**. Phase 2 is **complete**.

## Work packages

### P2.1 — Define Phase 2 contracts and extend the active-session boundary

**Outcome:** Classification data has runtime-validated, privacy-bounded
contracts before routes, providers, or UI consume it.

Create a feature area such as `src/server/categorization/`; retain a
one-directional dependency graph:

```text
HTTP routes -> session categorization service -> history adapter / retriever / classifier
                                                  -> local provider adapter
UI ---------> typed API client ------------------------------------------------^
```

Keep Phase 1 `ExtractedTransaction` immutable. Define Zod schemas and inferred
TypeScript types for at least the following (names may differ if the semantics
remain the same):

```ts
type WalletHistoryRecord = {
  recordId: string;
  date: string; // ISO date
  payee?: string;
  description: string;
  amountMinor: number; // internal integer PHP centavos
  currency: 'PHP';
  categoryName: string;
  accountName?: string;
  sourceRowId?: string;
  note?: string;
};

type CategoryCatalogEntry = {
  categoryId: string; // deterministic active-session identifier, not Wallet REST ID
  categoryName: string;
  exampleCount: number;
};

type RetrievedExample = {
  historyRecordId: string;
  categoryName: string;
  payee?: string;
  description: string;
  amountMinor: number;
  date: string;
  score: number; // finite [0, 1]
};

type ClassificationOutcome =
  | 'proposed'
  | 'unknown'
  | 'low_confidence'
  | 'provider_unavailable'
  | 'provider_malformed';

type CategoryProposal = {
  proposalId: string; // opaque random ID
  sourceRowId: string;
  categoryName?: string;
  classificationConfidence: number; // finite [0, 1]
  rationale: string; // bounded, reviewer-facing; never raw model text
  outcome: ClassificationOutcome;
  reviewState: 'needs_review';
  retrieval: RetrievedExample[]; // bounded/redacted projection only
  issues: Issue[];
};
```

Add specific issue codes for history validation and classification outcomes,
for example `history_schema_invalid`, `history_invalid_record`,
`history_unsupported_currency`, `history_empty_categories`,
`provider_not_configured`, `provider_unavailable`, `provider_malformed`,
`category_not_allowed`, and `low_classification_confidence`. Preserve Phase 1
issues; do not weaken its existing closed schemas without updating all callers.

Extend the existing `SessionStore` entry (or a cohesive session aggregate) with
an optional Phase 2 state. It must own history metadata, validated history
records, catalog, retrieval index, provider configuration safe for display,
and proposals. Do not put financial content in browser storage, query strings,
logs, thrown `Error` messages, or test snapshots. The Phase 1 clear path,
`clearAll()`, graceful shutdown, and stale-workspace behavior must remove the
new state without requiring a second cleanup action.

**Exit criteria:**

- Runtime-schema tests accept valid Phase 2 objects and reject invalid IDs,
  dates, confidence values, unbounded rationale/excerpts, unsupported currency,
  categoryless proposed outcomes, and categories outside the catalog.
- Unit tests prove the Phase 1 extraction object is not mutated by
  categorization and every proposal is traceable to exactly one `sourceRowId`.
- A session clear and shutdown test proves history/catalog/index/proposals are
  inaccessible afterward; no second Phase 2 session survives a clear.
- No new API path relies on `any`, unchecked JSON, or a client-supplied
  category/catalog/proposal as authoritative state.

### P2.2 — Implement bounded Wallet-history import and the first schema adapter

**Outcome:** A user can safely import the documented synthetic Wallet-history
format into the active session and receive a validated summary.

Add a separate multipart endpoint, for example
`POST /api/session/:id/history/import`, accepting exactly one `history` file.
Require an existing active session. Use an explicit file-size, row-count,
field-length, and decoded-text limit; document named constants beside the
existing ingestion limits. Do not reuse statement parsing based only on a file
extension.

For the first adapter:

- detect UTF-8 (BOM tolerated) semicolon-delimited CSV and require the exact
  supported header set listed in **Fixed decisions**; header order may be
  accepted only if names are unique and all required fields are present;
- parse RFC-style quoted fields with the locked CSV parser, preserving quoted
  semicolons/newlines correctly;
- validate each row: non-empty unique `record_id`, ISO date, bounded text,
  parseable two-decimal amount, `PHP`, non-empty category, and optional fields
  within documented bounds;
- convert money via the Phase 1 deterministic minor-unit helper; never use a
  float as an intermediate value;
- reject the entire import if the header is unknown, parsing is malformed,
  required columns are missing, duplicate record IDs occur, limits are
  exceeded, zero valid rows remain, or a record is invalid. Partial history is
  dangerous because it silently changes category evidence;
- replace an earlier history import only after the replacement has fully
  validated. On failure, retain the previously valid history/catalog/proposals
  unchanged and report a safe error;
- invalidate catalog/index/proposals atomically after a successful replacement
  and require categorization to be run again.

Return only a summary: history record count, distinct category count, distinct
account count, and adapter ID/version. Do not return the full history merely
because it was imported. Stable errors include an opaque request ID and stage,
not raw CSV rows, filenames, local paths, or parser stack traces.

**Exit criteria:**

- Route/integration tests cover the supplied synthetic fixture and assert its
  35 records, PHP-only validation, expected category count, and no raw-history
  data in the response or logs.
- Tests cover BOM, quoted delimiter/newline, missing/extra/duplicate headers,
  malformed CSV, duplicate `record_id`, bad date/amount/currency/category,
  empty file, row/size/field limits, unknown session, and a second import.
- A failed replacement leaves the first valid history and its prior proposals
  intact; a successful replacement removes prior proposals atomically.
- Import works with outbound network blocked, and file bytes never appear in
  browser storage, URL parameters, server logs, or repository paths.

### P2.3 — Build the category catalog and deterministic retrieval baseline

**Outcome:** The app can select relevant, reproducible local evidence without
calling a model.

Build the category catalog solely from validated history. Normalize category
identity using trim/collapsed whitespace and a deterministic case-insensitive
comparison, while retaining one canonical display spelling. Reject ambiguous
case/whitespace variants rather than silently merging two categories. Generate
stable active-session category IDs from normalized names; they are not Wallet
REST IDs and must not be treated as such in later phases.

Implement a pure, in-memory retriever. Normalization should Unicode-normalize,
case-fold, collapse whitespace, tokenize descriptions/payees conservatively,
and retain enough original text to show concise reviewer evidence. Score using
documented deterministic signals such as exact normalized description, token
overlap, normalized payee match, amount similarity, and optional recency.
Define tie-breakers (`score` descending, then history date descending, then
`recordId` ascending) and a small fixed maximum example count. Do not use the
source row ID as a signal: it appears in the synthetic fixture and would leak
fixture knowledge into real matching.

Add a baseline classifier that chooses a category only when unambiguous
thresholds are met (for example an exact normalized description with one
eligible category, or a documented score/margin threshold). Otherwise it
returns `unknown`. Baseline output must use the same proposal schema as a
model-assisted result and be included in evaluation metrics.

**Exit criteria:**

- Catalog tests prove only validated active-session history categories are
  eligible; a fabricated model category cannot pass validation.
- Retrieval unit tests are deterministic across repeated runs, do not mutate
  the history, enforce maximum evidence size, and verify tie-breaking and
  category ambiguity behavior.
- Tests demonstrate that changing an irrelevant history row does not change a
  query result, while a relevant exact-match row produces expected evidence.
- Baseline tests show it proposes only at documented confidence/margin
  thresholds and otherwise produces `unknown` plus `needs_review`.

### P2.4 — Add the local-model provider interface and connection/privacy test

**Outcome:** A selected local runtime can be configured and tested without
allowing statement data to reach the Internet.

Define a provider interface that separates discovery/health from
classification. It should accept sanitized classification input (source
transaction projection, bounded category allowlist, bounded retrieved
examples, and output schema/version) and return either structured candidate
data or a typed unavailable/malformed result. It must not expose a generic
arbitrary-prompt endpoint to the browser.

Implement the first adapter for a local OpenAI-compatible service. Its base URL
is configured at runtime for the active session only. Parse and validate the
URL server-side before use: reject non-HTTP(S), credentials, fragments,
non-loopback hosts/IP literals, link-local/private-but-non-loopback addresses,
and redirects. Resolve `localhost` and re-check every resolved address before
connecting to mitigate DNS rebinding. Disable automatic redirects. Apply
bounded connect/read timeouts, request-body/output-size limits, and cancellation
when the session is cleared. Never persist an endpoint URL if it contains
sensitive material; do not accept headers, tokens, or custom proxy settings.

The setup screen must provide a **Test local connection** action. It may call a
provider health/model-list endpoint using no statement/history content. It
reports reachable/unreachable and a non-sensitive selected-model label; it must
not claim a provider is safe merely because it responded. The server remains
the only process that communicates with the provider, so browser JavaScript
never receives provider credentials or raw replies.

Keep Apple Intelligence behind an unimplemented adapter boundary unless an
approved, testable local bridge is available. Do not simulate support with a
cloud API or an undocumented shell integration.

**Exit criteria:**

- Provider contract tests cover a valid schema response, timeout/refusal,
  non-JSON response, oversized response, missing fields, invalid confidence,
  and cancellation on session clear.
- URL-validation tests reject remote, credentialed, redirected, and
  non-loopback destinations and accept only documented loopback forms.
- An integration test with outbound network blocked completes the connection
  test and classification against a local fake OpenAI-compatible server.
- Captured provider requests demonstrate bounded data only; no token, raw
  history file, filesystem path, full source excerpt, or arbitrary browser
  prompt is sent.

### P2.5 — Orchestrate categorization, validation, and safe fallbacks

**Outcome:** Every extraction row receives a deterministic, auditable proposal
or an explicit review-required non-proposal.

Add `POST /api/session/:id/categorize` (or an equivalent explicit action). It
requires an active extraction and validated history; return stable
`history_not_imported` / `provider_not_configured` errors instead of silently
using stale data. The request must not accept statement rows, categories,
examples, prompts, or provider URLs from the client.

For each extracted transaction:

1. retrieve deterministic local examples and attempt the baseline;
2. use the baseline directly only when its configured high-confidence rule is
   satisfied, otherwise call the selected local provider;
3. require a schema-valid structured response containing only an allowed
   category or `unknown`, finite confidence, short rationale, and references
   that correspond to retrieved examples;
4. validate allowlist membership and references, clamp nothing, and reject
   unsupported values instead of repairing them;
5. apply a documented confidence threshold. An `unknown`, low-confidence,
   unavailable, or malformed result becomes `reviewState: 'needs_review'`
   with a precise safe issue code; it is never auto-approved;
6. commit the complete proposal set atomically only if the run is current for
   the session/history version. Clearing/replacing history while a run is
   pending cancels/discards the result rather than allowing stale proposals.

Use bounded concurrency to avoid overloading local hardware, retain input
order in API output, and report a completion summary by outcome. The raw model
reply may be held only transiently for schema parsing and must be discarded;
store the sanitized rationale and validated evidence projection only. A provider
failure for one row must create a per-row review-required outcome while other
rows continue unless the session is cleared or the provider configuration is
invalid for the entire run.

**Exit criteria:**

- Service/integration tests prove all outcomes (`proposed`, `unknown`,
  `low_confidence`, `provider_unavailable`, `provider_malformed`) are
  represented as `needs_review` unless and until Phase 3 explicitly changes
  review state.
- Tests reject hallucinated categories and example IDs, malformed JSON,
  duplicate/missing source rows, stale history versions, and out-of-range
  confidence without converting them into a valid proposal.
- Tests prove baseline decisions avoid a provider call when eligible; all
  non-baseline provider requests contain only the bounded contract input.
- Clear/reimport-during-run tests prove no stale proposal is observable after
  cancellation and no data is retained in a rejected run.
- A result for the supplied statement fixture contains exactly one outcome per
  extracted row (33 at the Phase 1 fixture exit) and preserves source-row
  ordering and traceability.

### P2.6 — Deliver the accessible Phase 2 setup and proposal UI

**Outcome:** Users can perform the Phase 2 flow and understand why records need
review without being given Phase 3 approval controls prematurely.

Extend the current extraction screen only after the server contracts are
stable. Provide: supported-history file selection/drag target; safe history
summary and replacement notice; local-provider configuration with connection
test; an explicit categorize action; pending/progress/error states; and a
compact read-only proposal list or summary. Show category, confidence,
rationale, evidence count, and outcome/issue status for each source row. The
existing source-detail affordance remains available.

Use native controls, associated labels, keyboard-operable actions, visible
focus, and an `aria-live` status/error region. Disable categorization until
history and provider prerequisites are satisfied (except when a documented
baseline-only mode is intentionally selected). Prevent duplicate import/test/
categorization requests while pending. On a clear, immediately remove all
Phase 1 and Phase 2 content from the view before awaiting the server response.

Never render raw provider prompts/responses or the complete imported history.
Do not label a category as final, approved, committed, or synced. Direct users
to the future review stage for non-final wording.

**Exit criteria:**

- Component tests cover initial, history-validating, history-error, provider
  unreachable, ready, categorizing, completed, and clear states; assertions
  include keyboard use and screen-reader status announcements.
- UI tests prove unknown/low-confidence/unavailable/malformed outcomes are
  visibly review-required and cannot be presented as approved.
- A browser E2E test imports the synthetic statement and history, tests a fake
  loopback provider, categorizes, confirms result counts/source traceability,
  and clears without any external network request.
- UI error states display only safe code/stage/actionable messaging, never
  raw financial rows, provider response, token, prompt, or local path.

### P2.7 — Add the synthetic evaluation harness, privacy checks, and handoff documentation

**Outcome:** Classification quality and local-only behavior are measurable and
reproducible by another engineer from a clean clone.

Create versioned, explicitly synthetic labeled evaluation cases separate from
the history import fixture. Each case must identify an input transaction,
allowed expected category (or `unknown`), and an explanation of any ambiguous
or split-derived case. Do not derive labels from source row IDs at runtime.
Cover exact merchant repeats, similar descriptions with different categories,
unseen merchants, installment text, fees, category ambiguity, and malformed or
unavailable provider outputs.

Provide a testable evaluation runner for baseline and model-assisted modes.
Record, at minimum: total cases, coverage (non-unknown proposal rate),
precision among non-unknown proposals, unknown rate, per-category support,
low-confidence rate, malformed/unavailable rate, and a confidence-bucket
calibration table. Define zero-denominator behavior explicitly. Evaluation
must use deterministic fake-provider fixtures in CI; a real local model may be
run manually but must report its model/provider version and never become a
required networked CI dependency.

Update README and relevant architecture/privacy documentation with supported
history schema, local-runtime requirements, how to start a compatible local
provider, exact data sent to that provider, limits, clear-session behavior,
baseline versus model behavior, and the fact that categorization remains
advisory pending Phase 3 review. Include commands for the new tests/evaluation
and a troubleshooting table that exposes no sensitive diagnostics.

**Exit criteria:**

- The evaluation command produces identical baseline metrics on repeated runs
  from the committed synthetic fixtures and is included in the documented test
  workflow or CI suite.
- Unit tests validate metric calculations, confidence buckets, ambiguous-label
  handling, and zero-denominator cases.
- Privacy tests block external network and assert history import,
  retrieval, baseline classification, and fake-local-provider classification
  complete without an outbound request.
- `npm run check`, dependency audit, secret scan, repository-sensitive-file
  scan, build, and the new Phase 2 unit/integration/E2E checks pass from a clean
  install without a real statement, Wallet export, token, model, or Internet
  connection after dependencies are installed.

## Phase 2 definition of done

Phase 2 is complete only when all package exit criteria are met and the
following end-to-end assertions hold:

1. Starting with the completed Phase 1 synthetic BDO extraction, a user can
   import the supported synthetic Wallet-history CSV into the same active
   session and see only a safe summary.
2. With outbound network blocked, a local fake OpenAI-compatible runtime can
   be connection-tested and used to classify all 33 extracted fixture charges.
   No request escapes loopback and no financial content is logged or persisted
   beyond the active session/encrypted workspace policy.
3. Every source charge has exactly one schema-valid proposal outcome, its
   retrieved evidence is bounded and traceable, and its category is either in
   the active history catalog or explicitly `unknown`.
4. Low-confidence, unknown, unavailable, and malformed results are visibly
   `needs_review`; none can be called approved, split, deduplicated, or sent to
   Wallet.
5. Replacing history or clearing the session invalidates/cancels Phase 2 state
   deterministically. Refreshing restores neither history nor proposals.
6. Baseline and fake-provider evaluation metrics are reproducible from
   committed synthetic fixtures, and all repository quality gates pass.

## Explicit non-goals and handoff to Phase 3

Do not accept a Phase 2 change that adds any of the following under a different
name: an approval state transition, category editing, split allocation,
duplicate detection, automatic exclusion, cross-session history retention,
Wallet API credentials/accounts, REST writes, or a remote/cloud model fallback.

Phase 3 may build its review table and edit controls on `CategoryProposal`, but
must preserve source traceability, provider/rationale evidence, the active
history category catalog, and the invariant that no row is commit-eligible
until the reviewer explicitly approves it.
