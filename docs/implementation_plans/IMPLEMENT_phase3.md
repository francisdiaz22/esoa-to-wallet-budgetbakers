# Phase 3 implementation runbook — validation, duplicate detection, and HITL review

## Purpose and completion boundary

Phase 3 converts Phase 2's read-only, advisory category proposals into a
reviewable set of user decisions. It gives the reviewer enough source,
classification, duplicate, and edit context to resolve every row locally
before any Wallet credential or REST write exists.

At the end of this phase, each extracted statement charge is represented by one
or more session-scoped review items and is either:

- explicitly `approved`, with a valid category from the active-session catalog
  and no blocking validation issue; or
- explicitly `excluded`, with a bounded reviewer-selected reason; or
- still `needs_review`, and therefore ineligible for the Phase 4 commit flow.

The default remains one source charge to one review item. A reviewer may split
a source charge into multiple items only when their centavo-exact signed total
equals the source amount. Duplicate detection identifies duplicate _candidates
within the imported eSOA_; it never deletes, merges, excludes, or approves a
row automatically.

This phase does **not** accept Wallet API tokens, fetch Wallet accounts or
categories, call Wallet REST endpoints, write a transaction database, compare
against existing Wallet transactions, persist review decisions across sessions,
or introduce cloud processing. Destination-account selection and the final
REST-facing category/account mapping belong to Phase 4. In this phase,
“commit-eligible” means review-approved and structurally valid; it does not
mean that a Wallet destination has been selected or that a write can occur.

Read this document together with [IMPLEMENTATION.md](IMPLEMENTATION.md),
[IMPLEMENT_phase1.md](IMPLEMENT_phase1.md),
[IMPLEMENT_phase2.md](IMPLEMENT_phase2.md), [SECURITY.md](../../SECURITY.md),
and ADRs 0001–0004 before making changes.

## Fixed decisions for this phase

| Concern             | Decision                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authority           | The reviewer is authoritative. Parser and model output remain evidence, never an approval. Server-side validation owns all review state; browser payloads are requests, not trusted state.                                                                                                                                                                   |
| State lifetime      | Review items, edits, duplicate groups, audit events, and generated summaries are active-session data only. They are cleared by the existing clear, shutdown, and stale-workspace lifecycle. No browser persistence is introduced.                                                                                                                            |
| Source immutability | `ExtractionResult.transactions`, source locations, raw excerpts, source amounts, and original Phase 2 proposals are immutable evidence. Review edits are overlay/derived state; do not mutate extraction or history records.                                                                                                                                 |
| Money               | Store, compare, and split money as integer PHP centavos. Convert Phase 1 API numbers with the established deterministic helper; never use floating-point arithmetic for the split sum check.                                                                                                                                                                 |
| Category authority  | A selected category must exactly match a current entry in the active-session Phase 2 catalog. `unknown` is useful evidence but is never approvable. Replacing history invalidates all review state because its category authority changed.                                                                                                                   |
| Duplicate scope     | Detect only exact/near duplicates in the current imported statement. Cross-checking Wallet history or remote Wallet records is deferred. A duplicate warning is non-blocking unless another validation rule is blocking.                                                                                                                                     |
| Duplicate signals   | Exact duplicate key: canonical date + signed amountMinor + normalized description + normalized reference when both references are present. Near-match scoring considers date distance, amount equality, normalized description/token similarity, and reference equality. Signals and thresholds are versioned server configuration, not free-form UI inputs. |
| Splits              | Splits are reviewer-created only. Each child keeps the parent `sourceRowId`, has a new opaque `reviewItemId`, an explicit signed `amountMinor`, category, optional bounded payee/note, and independent review state. Splits cannot be nested.                                                                                                                |
| Re-categorization   | A reviewer can re-run classification only for an unsplit source item that was edited or flagged. It must retain unrelated decisions and evidence. Reclassification replaces only the classification evidence for that item and returns it to `needs_review`; it must never silently re-approve it.                                                           |
| Audit               | Keep a bounded, append-only, non-sensitive event trail in memory. It records action type, target IDs, timestamp, and safe before/after summaries—not raw source text, history rows, prompts, provider replies, paths, or tokens.                                                                                                                             |
| UI boundary         | Replace the compact Phase 2 read-only proposal list with an accessible review workspace. Keep history import and local-provider setup available as prerequisites, but do not add Wallet-token, account, sync, or commit controls.                                                                                                                            |

## User-visible flow

1. After Phase 2 categorization, the application prepares review state by
   joining every extracted transaction to exactly one Phase 2 proposal and
   running duplicate detection over the extraction.
2. The user opens the review workspace and sees a summary plus filters for
   `needs_review`, warnings/errors, duplicate candidates, approved, and
   excluded items. The default view prioritizes blocking issues and uncertainty.
3. Selecting a row opens a keyboard-operable detail drawer. It shows the source
   excerpt/location, extraction confidence and issues, proposed category and
   rationale, bounded historical examples, duplicate candidates, and the review
   decision controls.
4. The reviewer accepts or changes a category, optionally edits a bounded
   payee/note, excludes an item with a reason, or creates a balanced split.
   Every mutation is validated on the server and reflected immediately in the
   final summary.
5. For a flagged or edited unsplit item, the reviewer may request targeted
   re-categorization. Only that source item is sent through Phase 2 retrieval
   and provider logic; all other review decisions remain intact. The result is
   review-required again.
6. The user can bulk-approve only eligible, non-flagged, unsplit items after an
   explicit preview of the number affected. Duplicate candidates and items with
   warnings/errors are excluded from that bulk action; individual approval
   remains available when non-blocking warnings have been consciously reviewed.
7. The pre-commit summary displays approved, excluded, needs-review, blocking,
   duplicate-candidate, and split counts plus approved PHP total. It makes clear
   that Wallet writes are not part of this phase.
8. The user can download a redacted review summary and can clear the session.
   Refreshing restores no review state, audit trail, or downloaded artifact.

## Dependency order

Implement in this order. Do not add UI-only mutable review state or route-local
parallel stores; all review mutations must flow through the session aggregate.

```text
P3.1 contracts, issue codes, and session aggregate
  -> P3.2 deterministic validation and duplicate detector
  -> P3.3 review service, state transitions, and audit trail
  -> P3.4 targeted re-categorization integration
  -> P3.5 review HTTP API and redacted export
  -> P3.6 accessible review workspace and detail drawer
  -> P3.7 fixture-driven integration/E2E/privacy verification
  -> P3.8 documentation and Phase 4 handoff
```

## Progress tracker — senior engineering review updated 2026-08-30

Phase 3 remains **implemented but not yet complete against every exit criterion
in this runbook**. The 2026-08-30 remediation added strict UUID/calendar-date
contracts, a real return-to-review API, compact list/detail projections,
server-authoritative category options, drawer focus trapping, fixture-driven
duplicate and 33-to-35/PHP 34,957.17 reconciliation checks, an expanded browser
review/privacy flow, and a version-checked Phase 4 projection contract. The
remaining release work is the full split-child editing/removal browser flow and
the exhaustive 35-leaf E2E approval/exclusion reconciliation.

| Package | Status      | Verified work                                                                                                                                                                                                                    | Remaining work                                                                                                                                   |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P3.1    | Complete    | Shared issue schema, strict opaque review IDs/calendar dates, revisions, session-owned review state, immutability and lifecycle tests.                                                                                           | —                                                                                                                                                |
| P3.2    | Complete    | Pure duplicate detector, fixture-driven normalization/scoring and mutation checks, validator, and centavo-based split/reconciliation checks.                                                                                     | —                                                                                                                                                |
| P3.3    | In progress | `ReviewService` implements edit, approve, exclude, split, bulk approval, return-to-review, and bounded audit behavior.                                                                                                           | Expose and test a real return-to-review API; add the missing transition/idempotency, signed split, audit redaction, and atomic-failure coverage. |
| P3.4    | In progress | A targeted re-categorization path exists and rejects split children.                                                                                                                                                             | Add the required success/failure/concurrency tests proving exactly one row is processed and every unrelated revision/decision is preserved.      |
| P3.5    | Complete    | Review routes, revision checks, compact list/full detail boundary, bounded source/audit evidence, safe envelopes, and redacted in-memory deterministic CSV export.                                                               | —                                                                                                                                                |
| P3.6    | In progress | Server-only catalog, real return-to-review, one rendered workspace, detail API loading, focus trap/return, component and keyboard coverage, plus existing review controls.                                                       | Add split-child update/removal controls and their removal confirmation to the active workspace; then delete the now-disabled legacy JSX copy.    |
| P3.7    | In progress | 107 unit/integration/component tests pass; committed review fixtures are consumed; 33-to-35/PHP 34,957.17 is checked; Playwright covers review detail, approval/return, export, focus, persistence, outbound network, and clear. | Extend Playwright through both documented splits and resolution of all 35 leaves; add explicit screenshot/snapshot text scans.                   |
| P3.8    | Complete    | README/SECURITY distinguish approval from commit; the handoff projection now requires matching review/history versions and has approved-leaf/stale-version contract coverage.                                                    | —                                                                                                                                                |

### Review evidence and release blockers

Review performed against the working tree on 2026-08-30:

- `npm run format:check`, `npm run lint`, and `npm run typecheck` pass.
- `npm test -- --run` passes when temporary loopback listeners are permitted:
  25 test files and 103 tests. In the restricted sandbox the same network-bound
  tests fail with `listen EPERM`; that is an execution-environment limitation,
  not an application assertion failure.
- No `e2e/phase3.spec.ts` or equivalent Phase 3 Playwright coverage exists;
  the checked-in E2E suite stops at Phases 1 and 2.
- `src/client/App.test.tsx` mocks only Phase 1/2 API functions and contains no
  component tests for review initialization, filters, mutations, splits,
  re-categorization, bulk approval, export, drawer focus trapping, or review
  clearing.
- The review category selector is assembled from current item categories plus
  a hard-coded fallback list. This violates the active-session catalog boundary
  and can present categories the server will reject.
- The UI's **Return to review** action sends an empty item patch. That operation
  does not call `ReviewService.returnToReview`, so an approved or excluded item
  is not reliably returned to `needs_review`.
- Split-child update/delete client functions exist but are not wired into the
  review workspace. The required split removal confirmation and unbalanced
  intermediate editing flow are therefore unavailable to the reviewer.
- The drawer reads source evidence from the page's extraction state and never
  calls the review detail endpoint; meanwhile the list endpoint returns full
  `ReviewItem` objects. The intended compact-list/detail boundary is not met.
- The dialog handles Escape and focus return, but there is no focus trap. The
  `App.tsx` review workspace markup is duplicated, which increases regression
  risk and can render the workspace twice.
- `duplicate_cases.json`, `split_cases.json`, and `expected_summary.json` are
  present but are not referenced by source, integration, evaluation, or E2E
  tests. No automated test proves the documented 33-source to 35-leaf,
  PHP 34,957.17 reconciliation.
- `getApprovedForCommit()` exists, but no test exercises it. It filters invalid
  approved items instead of failing the projection as the exit criterion says,
  and it has no explicit caller-supplied/current review-history version check.

Phase 3 may be marked complete only after these blockers are resolved and the
full project gates in P3.7 pass with the Phase 3 E2E and privacy coverage in
place.

## Work packages

### P3.1 — Define review contracts and extend the active-session aggregate

**Outcome:** Review data is runtime-validated, traceable, and session-bound
before routes or UI mutate it.

Create `src/server/review/` and maintain one-directional dependencies:

```text
HTTP review routes -> review service -> validator / duplicate detector / audit
                                      -> categorization service (targeted run)
SessionStore <----- review service
UI ---------------> typed API client
```

Keep `ExtractedTransaction` and `CategoryProposal` immutable. Define Zod
schemas and inferred types equivalent to the following. Exact names may vary,
but their semantics and limits may not.

```ts
type ReviewState = 'needs_review' | 'approved' | 'excluded';
type ReviewItemKind = 'source' | 'split';

type DuplicateMatch = {
  candidateReviewItemId: string;
  candidateSourceRowId: string;
  matchKind: 'exact' | 'near';
  score: number; // finite [0, 1]
  matchedSignals: Array<'date' | 'amount' | 'description' | 'reference'>;
};

type ReviewItem = {
  reviewItemId: string; // opaque random ID
  kind: ReviewItemKind;
  sourceRowId: string;
  parentReviewItemId?: string; // required only for split children
  amountMinor: number; // signed PHP centavos; source value for unsplit item
  date: string;
  description: string; // copied bounded display projection; source remains authority
  payee?: string;
  note?: string;
  categoryName?: string;
  reviewState: ReviewState;
  exclusionReason?:
    'not_a_transaction' | 'duplicate_confirmed' | 'out_of_scope' | 'other';
  proposal: CategoryProposal; // immutable/sanitized classification evidence
  duplicateMatches: DuplicateMatch[];
  issues: Issue[]; // derived + decision validation issues
  revision: number;
};

type ReviewSummary = {
  totalItems: number;
  sourceChargeCount: number;
  approvedCount: number;
  excludedCount: number;
  needsReviewCount: number;
  blockingCount: number;
  warningCount: number;
  duplicateCandidateCount: number;
  splitSourceCount: number;
  approvedExpenseTotalMinor: number;
};

type ReviewAuditEvent = {
  eventId: string;
  occurredAt: string;
  action:
    | 'review_initialized'
    | 'category_changed'
    | 'payee_changed'
    | 'note_changed'
    | 'approved'
    | 'excluded'
    | 'split_created'
    | 'split_updated'
    | 'split_removed'
    | 'recategorized';
  reviewItemId?: string;
  sourceRowId: string;
  safeDetails: Record<string, string | number | boolean | string[]>;
};
```

Add Phase 3 issue codes to the shared canonical `IssueSchema` in both
`src/server/ingestion/contracts.ts` and
`src/server/categorization/contracts.ts`, or refactor to one shared schema so
they cannot drift. At minimum include: `duplicate_exact`, `duplicate_near`,
`category_required`, `category_not_allowed`, `review_not_approved`,
`split_total_mismatch`, `split_invalid`, `split_parent_locked`,
`review_revision_conflict`, `reclassification_not_allowed`, and
`review_limit_exceeded`. Define severity and whether each code blocks approval;
the UI must not infer that policy from text.

Extend the existing `SessionStore` `Phase2State` into a cohesive phase-2/3
aggregate or add an explicitly owned `phase3` member. It must retain the
immutable initial proposal set separately from mutable review items. Initialization
is permitted only when extraction, history/catalog, and a complete one-to-one
proposal set are current for the same session/history version. Replacing history
or recategorizing must invalidate/rebuild review data atomically; clearing and
shutdown must remove it.

Use a server-issued integer `revision` on every review item and require it on
single-item update requests. Return `409 review_revision_conflict` rather than
silently overwriting a simultaneous tab/action. Bulk operations may instead use
a review-set version and fail atomically if it changes before commit.

**Exit criteria:**

- Schema tests reject invalid IDs, non-ISO dates, non-finite scores, amount
  floats/non-integers, unbounded strings/events, invalid split lineage, invalid
  exclusion state, categoryless approvals, and unknown issue/action values.
- Tests prove extraction/proposal evidence is not mutated by review actions and
  every review item remains traceable to exactly one source charge.
- Tests prove session clear, shutdown, extraction replacement, and history
  replacement make review items/audit/events inaccessible without a second
  cleanup path.
- No review API accepts a client-supplied source excerpt, proposal, category
  catalog, duplicate score, audit event, or authoritative amount/date.

### P3.2 — Build deterministic validation and within-statement duplicate detection

**Outcome:** Every review item has explainable approval blockers and duplicate
candidate notes before a human changes it.

Implement pure functions for review eligibility and duplicate grouping. Build
the initial review set in extraction source order; retain that order as the
stable default presentation order. A valid unsplit source item copies its signed
amount from the source transaction and its initial category/proposal evidence
from the matching Phase 2 proposal.

Validate at least:

- valid source transaction and current proposal linkage;
- category present and exactly allowlisted before approval;
- `unknown`, provider failure, malformed output, and low-confidence outcomes
  remain review-required until a reviewer supplies a category;
- date/amount/description remain source-owned for unsplit records;
- exclusion reason is required only for `excluded` and must be removed when an
  item becomes `needs_review` or `approved`;
- split children have non-empty category before approval and their signed total
  equals the original source amount exactly in centavos;
- a source parent with children is a structural container, never independently
  approvable/excludable/committable; all active children determine its status;
- blocking parser errors always prevent approval. Warnings and duplicate
  candidates are visible but do not silently change a user's explicit decision.

For duplicate detection, create pure normalization functions for descriptions
and references: Unicode NFKC, case-fold, trim/collapse whitespace, conservative
punctuation removal, and tokenization. Do not include `sourceRowId`, raw OCR
line order, or classification category as a duplicate signal.

Run exact grouping first. Then score only reasonable candidate pairs (for
example, exact amount and a bounded date window) to avoid quadratic work on
large imports. Version named thresholds/constants beside the existing limits;
document weights and tie-breakers. A recommended near-match score is:

| Signal      | Rule                                        | Weight            |
| ----------- | ------------------------------------------- | ----------------- |
| Amount      | exact signed centavo equality               | 0.35              |
| Date        | same day / within 1 day / otherwise         | 0.25 / 0.15 / 0   |
| Description | normalized exact / bounded token similarity | 0.30 / up to 0.30 |
| Reference   | exact when both present                     | 0.10              |

Use a conservative near-match threshold (recommendation: `>= 0.80`) and expose
the matched signals and score—not the private implementation weights—in the
review detail. Exact candidates receive `duplicate_exact`; near candidates
receive `duplicate_near`. Do not label a row as a confirmed duplicate.

**Exit criteria:**

- Unit tests cover exact duplicates, near duplicates, same merchant on different
  legitimate dates, same amount with unrelated descriptions, reference matches,
  missing references, punctuation/case/Unicode normalization, deterministic
  ordering, and no self-pair/duplicate pair.
- A fixture-backed test confirms every BDO source row participates in at most
  the documented candidate groups and expected synthetic duplicates are flagged
  with traceable counterpart IDs.
- Tests prove detector output is deterministic and does not mutate extraction,
  proposals, history, or category catalog.
- Review validation tests prove no blocked item or unbalanced split can become
  approved, while a duplicate warning alone never auto-excludes a row.

### P3.3 — Implement review mutations, approvals, splits, and the audit trail

**Outcome:** Every decision is explicit, validated, conflict-safe, and
explainable in the active session.

Create a `ReviewService` that initializes review once from current extraction +
proposals and is the only writer for review state. Do not use React state as the
source of truth. Every route invokes it with the current item/review-set
revision; it returns the changed item plus a fresh summary (and limited list
projection when required).

Implement these operations:

- **Edit category/payee/note:** category must be allowlisted; payee/note are
  bounded display fields and must be separate from immutable source description.
  Any category edit moves the item to `needs_review` until explicitly approved.
- **Approve one:** permit only an unsplit valid item or a valid split child with
  a selected category and no blocking issues. Explicit approval is required even
  for high-confidence baseline proposals.
- **Exclude one:** require a controlled reason and optional bounded note. It is
  a reviewer decision, not a duplicate detector outcome.
- **Return to review:** allow an approved/excluded eligible item to become
  `needs_review`; clear stale exclusion reasons as appropriate.
- **Bulk approve:** select only server-calculated eligible items. Exclude rows
  with any warning/error, any duplicate candidate, unbalanced split, unknown
  category, or already terminal state. Require a server-confirmed preview count
  and the review-set version. Never accept arbitrary IDs as an unvalidated bulk
  approval list.
- **Create/update/remove split:** allow only one split level. Creating a split
  replaces the source item with a non-committable parent plus at least two
  children initialized to `needs_review`. Editing a child amount validates the
  source-total invariant on every mutation; while unbalanced, no child can be
  approved. Removing all children restores one source item with its original
  Phase 2 evidence and `needs_review`; retain an audit event.

For split category proposals, do not claim that the provider classified the
allocation. Initialize each child with a bounded reviewer-facing rationale such
as “Created by reviewer split; select or confirm a category,” with no fabricated
retrieval evidence. Child descriptions may inherit the source description only
as display context; Phase 4 must map each child amount/category explicitly.

Add a bounded audit event after each accepted mutation. Safe details may include
state/category names, allowed fixed reason, item count, amounts, and candidate
IDs. Do not store prior/new source descriptions, free-text reviewer notes,
history evidence text, raw model data, or any event that duplicates sensitive
content. Cap events per session; when the cap is reached, reject further edits
with `review_limit_exceeded` rather than silently discarding audit history.

**Exit criteria:**

- Service/route tests cover every legal and illegal state transition, revision
  conflicts, idempotent retries where applicable, and atomic failure (no partial
  split/bulk mutation).
- Tests verify approval needs an explicit action, an allowlisted category, and
  no blocking issue; `unknown` cannot be approved without a reviewer category.
- Split tests cover positive/negative signed expense amounts, centavo rounding,
  adding/removing children, an unbalanced intermediate state, no nesting, parent
  lock, and restoration to the original source item.
- Audit tests assert event order, bounded safe fields, no financial excerpt or
  free-text note leakage, lifecycle removal, and a redacted exported view.

### P3.4 — Add targeted re-categorization without disturbing other decisions

**Outcome:** Editing or flagging a record can refresh only its classification
evidence, preserving the rest of the statement review.

Refactor `ClassificationService.categorize()` so it has a lower-level,
server-only operation that receives authoritative extracted source row IDs and
produces validated proposals for that subset. The existing whole-statement
route should call the same operation with all source rows to preserve Phase 2
behavior and tests. The browser must not submit transaction content, retrieval
examples, category lists, prompts, or provider configuration.

Provide a review route/action for exactly one unsplit source item. It is allowed
only when the item is `needs_review` or has been edited/flagged since its last
classification. Split children cannot be reclassified automatically because
they are reviewer-created allocations; return `422 reclassification_not_allowed`
with safe guidance. A provider configuration/history requirement follows the
existing Phase 2 behavior.

Before starting, capture session ID, history version, source item revision, and
review-set version. Mark only that item pending. On success, replace that
item's proposal/retrieval/rationale/outcome atomically, re-run derived
validation/duplicate display if editable fields affect it, increment revision,
append `recategorized`, and set `reviewState: 'needs_review'`. Preserve all
other items, approvals, exclusions, splits, and audit events. On provider
unavailability or malformed response, use the existing Phase 2 per-row fallback
proposal and leave the item review-required. If history changes, session clears,
the item splits, or its revision changes while pending, discard the result with
a stable `409` conflict/stale result and retain current review state.

Do not rerun a full categorization after a simple manual category edit. The
reviewer already supplied the authoritative category; provide reclassification
as an intentional action only.

**Exit criteria:**

- Tests verify exactly one provider/retrieval call is made for the selected
  source row and unrelated proposal IDs/review states/revisions are unchanged.
- Tests cover baseline success, provider success, unknown, unavailable,
  malformed, history replacement, session clear, concurrent edit, and split
  rejection.
- A successful reclassification never auto-approves, including high-confidence
  output, and cannot replace reviewer-created split evidence.

### P3.5 — Expose a safe review API and redacted review-summary export

**Outcome:** The client receives only the state necessary to review and mutate
the active session, with stable error handling and no sensitive export surprise.

Add routes beneath `/api/session/:id/review` (exact paths may differ if typed
client and tests are updated together). Recommended endpoints:

```text
POST   /:id/review/initialize
GET    /:id/review
GET    /:id/review/:reviewItemId
PATCH  /:id/review/:reviewItemId
POST   /:id/review/:reviewItemId/approve
POST   /:id/review/:reviewItemId/exclude
POST   /:id/review/:reviewItemId/reclassify
POST   /:id/review/:reviewItemId/split
PATCH  /:id/review/:reviewItemId/split-items/:childId
DELETE /:id/review/:reviewItemId/split-items/:childId
POST   /:id/review/bulk-approve-preview
POST   /:id/review/bulk-approve
GET    /:id/review/summary-export
```

All mutation requests must use small, explicitly schema-validated JSON bodies
and carry `revision`/review-set version. Reject unknown fields. Use existing
safe envelope conventions (`code`, safe `message`, `stage`, `requestId`) and
never include stack traces, raw source/history data, local paths, prompts, or
provider replies in failures.

The list endpoint should return a compact row projection plus summary and
filter metadata; retrieve detailed evidence only for an active drawer item.
Pagination is not required for the current fixture, but impose a response-size
limit and add cursor pagination rather than returning unbounded full history if
future supported statements can be large.

The export must be an explicit user download, generated in memory as a CSV or
JSON with a documented schema. Default redaction: include session-safe IDs,
date, signed amount, selected category, review state, outcome, issue codes,
duplicate-candidate IDs, split lineage, and aggregate counts; exclude raw
source excerpts, descriptions, payees, notes, reference values, historical
example text, model rationale, provider configuration, account data, and audit
event free text. Give it a generic filename such as `review-summary.csv`; do
not derive a filename from a statement.

**Exit criteria:**

- Contract tests cover authorization by opaque session/item IDs, validation,
  missing/stale sessions, revision conflict, malformed bodies, response limits,
  and safe error envelopes.
- Integration tests prove a detail response can trace an item to source and
  proposal evidence without exposing history beyond bounded retrieved examples.
- Export tests verify exact redaction, RFC-style escaping, deterministic column
  order, aggregate reconciliation, and no file retained after download/session
  clear.
- Browser/API tests prove no review payload is stored in URL parameters,
  browser storage, logs, or test snapshots.

### P3.6 — Build the accessible HITL review workspace

**Outcome:** A reviewer can resolve every blocking issue without re-importing
the statement, using keyboard and screen-reader-accessible controls.

Replace the Phase 2 “Category proposals (read-only, advisory)” list in
`src/client/App.tsx` with a review route/workspace once proposals are present.
Do not make the initial page a new browser-persisted route; session state must
remain server-only and disappear after refresh as today.

The review screen must provide:

- a summary strip with counts for needs review, approved, excluded, blockers,
  duplicates, and approved total;
- filter chips/controls for `needs_review`, warnings/errors, duplicates,
  approved, and excluded; clear selected-filter state and result count;
- a semantic table with stable columns: state, date, description projection,
  signed amount, category, confidence/outcome, issue count, duplicate marker,
  and details action;
- a keyboard-operable detail drawer/dialog with a labelled title, focus
  management, Escape/close behavior, source location/excerpt, parser evidence,
  model rationale, retrieval examples, duplicate matches, and current audit
  summary;
- category selection sourced only from the server catalog, bounded payee/note
  fields, explicit approve/exclude/return-to-review actions, split editor with
  live remaining-centavo total, and targeted re-categorize where valid;
- confirmation dialogs for bulk approval, exclusion, split removal, and any
  action that changes multiple items; and
- pre-commit summary/export controls labelled “Review summary” and “Ready for
  Phase 4 setup,” never “Commit,” “Sync,” or “Sent to Wallet.”

Show warning/error reasons in text as well as color/icon. Keep issue status and
button disabled reasons accessible through associated text/`aria-describedby`.
Use `aria-live` for pending, success, and safe failure state; prevent duplicate
network mutations while a request is pending. On session clear, immediately
remove review table/drawer/summary/download state before awaiting the existing
DELETE request.

**Exit criteria:**

- Component tests cover initialization, empty/pending/error, filter changes,
  detail open/close/focus return, category edit, approval/exclusion, split
  mismatch, targeted reclassify pending/result, bulk preview/confirmation,
  export, and clear.
- Keyboard tests cover tab order, drawer focus trap/return, Escape, native
  select/input controls, table detail actions, and screen-reader live messages.
- UI tests prove `needs_review` cannot look approved, duplicates are candidates
  rather than facts, and Wallet account/token/commit controls do not appear.

### P3.7 — Add fixtures and run full validation, privacy, and end-to-end checks

**Outcome:** The review workflow is regression-resistant, local-only, and
reproducible without real financial data or a live Wallet account.

Add clearly labeled synthetic fixtures separate from the extraction oracle:

- a review fixture with known exact/near/non-duplicate pairs;
- source-charge split cases including centavo-exact and intentionally invalid
  totals; and
- expected review summaries/events with only safe synthetic fields.

Do not alter the existing 33-row extraction oracle merely to manufacture
duplicates. Test detector behavior with an additional explicitly synthetic
statement fixture or controlled pure-function inputs. Preserve the reconciliation
between the BDO extraction fixture (33 charges) and post-HITL Wallet fixture
(35 rows): the two expected review splits must reconcile exactly to PHP
34,957.17 and retain their original source IDs.

Add unit tests for pure contracts, validation, duplicate detection, split math,
and audit redaction; integration tests for routes/session lifecycle/targeted
reclassification; and Playwright coverage for the full synthetic statement →
history → fake-loopback provider → categorize → review → split → approve /
exclude → export → clear flow. Block outbound network as in Phase 2 and assert
only the existing local fake provider is contacted.

Run and update the project gates proportionately:

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
npm run check
```

**Exit criteria:**

- All checks pass from a clean install using only committed synthetic fixtures,
  a fake local provider, and no real statement/history/token/network service.
- E2E verifies each original source charge is resolved without re-importing,
  no row is Phase-4-ready until explicitly approved, and an unbalanced split
  cannot be approved/exported as ready.
- Privacy tests prove review state/export generation causes no outbound request
  and does not write sensitive data to browser persistence, repository paths,
  logs, screenshots, or snapshots.

### P3.8 — Document review behavior and provide an exact Phase 4 handoff

**Outcome:** Another contributor can use and extend review safely, and Phase 4
can consume a stable approved-set contract without reinterpreting decisions.

Update README, SECURITY, contributor guidance, and this progress tracker with:

- the review lifecycle and the meaning of every review state;
- duplicate scope/limitations and why a candidate is never auto-removed;
- split rules, signed-centavo reconciliation, and source lineage;
- targeted re-categorization behavior and the rule that it resets only the
  affected item to `needs_review`;
- export schema/redaction and ephemeral lifecycle; and
- explicit Phase 4 prerequisites: only approved, structurally valid leaf review
  items may be presented to account/category selection and the Wallet dry-run.

Define a server-side Phase 4 handoff projection now, but do not create Wallet
payloads or call Wallet APIs:

```ts
type ApprovedReviewItemForCommit = {
  reviewItemId: string;
  sourceRowId: string;
  date: string;
  amountMinor: number;
  currency: 'PHP';
  description: string;
  payee?: string;
  note?: string;
  categoryName: string; // local history display name, not Wallet REST ID
  sourceReference?: string;
  splitParentReviewItemId?: string;
};
```

The projection must reject containers, excluded/needs-review rows, missing
categories, invalid split totals, and stale history/review versions. Phase 4
will map `categoryName` to the destination Wallet category and attach the
user-selected Wallet account; Phase 3 must not pretend those mappings exist.

**Exit criteria:**

- Documentation accurately distinguishes review approval from Wallet commit.
- A contract test produces the expected approved-leaf projection for the BDO
  synthetic review fixture and rejects every non-eligible state.
- Another engineer can follow the documented tests and add a duplicate/split
  fixture without using real financial data.

## Phase 3 definition of done

Phase 3 is complete only when every package exit criterion is met and these
end-to-end assertions hold:

1. From a completed Phase 2 BDO session, the app initializes a deterministic
   review set with one item per each of the 33 extracted charges, preserving
   source and classification traceability.
2. The reviewer can filter, inspect, correct, approve, exclude, and split
   records entirely locally. Every blocking issue can be resolved without
   re-importing the statement.
3. Duplicate detection reports exact/near candidates with reasons and never
   performs automatic deletion, merging, exclusion, or approval.
4. No source item, split child, or bulk-selected row becomes approved without
   an explicit reviewer action, an allowlisted category, and deterministic
   validation. Unbalanced splits fail closed.
5. Reclassifying one eligible source record invokes only that record's
   retrieval/provider work, resets only it to `needs_review`, and leaves every
   unrelated decision intact.
6. The review summary/export is redacted, reproducible from synthetic fixtures,
   and clear/shutdown removes all Phase 3 state. No Wallet token, account,
   REST write, cloud request, transaction database, or cross-session cache is
   added.
7. The Phase 4 handoff projection contains exactly the explicitly approved,
   valid leaf review items and preserves source/split lineage for safe dry-run
   and commit work.

## Explicit non-goals and handoff to Phase 4

Do not accept a Phase 3 change that introduces a Wallet token field, credential
storage, account/category lookup from Wallet, REST payload creation, REST
writes, API retry journal, cross-Wallet matching, background synchronization,
automatic duplicate removal, persistent review history, or any remote/cloud
classification fallback.

Phase 4 begins by taking the `ApprovedReviewItemForCommit` projection, asking
for an ephemeral Wallet token, retrieving and selecting a writable destination
account/category mapping, showing a dry-run of the exact approved leaf set, and
handling per-item commit/retry outcomes. It must preserve Phase 3’s immutable
source lineage, split structure, explicit approval decisions, and session-only
data lifetime.
