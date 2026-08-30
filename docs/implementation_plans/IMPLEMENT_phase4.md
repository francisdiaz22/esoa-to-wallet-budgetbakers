# Phase 4 implementation runbook — Wallet REST commit and recovery

## Purpose and completion boundary

Phase 4 sends the exact, server-derived Phase 3 `ApprovedReviewItemForCommit`
set to Wallet. It adds an ephemeral credential, remote account/category
discovery, explicit mapping, a dry-run, and an in-memory per-item recovery
journal. Review remains authoritative: this phase must not create, categorize,
approve, split, exclude, or otherwise reinterpret statement rows.

At completion, the user can select one writable Wallet account, map every
approved local category, examine the precise records to be sent, explicitly
confirm, and see a correct outcome for every record. A same-session retry sends
only records known not to have succeeded.

Out of scope: persistent credentials/journals/caches, cross-session
idempotency, matching against existing Wallet records, background sync, MCP
writes, or automatic resolution/re-send of ambiguous network outcomes. A write
timeout is **unknown**, never implicit permission to resubmit it.

Read [IMPLEMENTATION.md](IMPLEMENTATION.md),
[IMPLEMENT_phase3.md](IMPLEMENT_phase3.md), [SECURITY.md](../../SECURITY.md),
and [ADR-0004](../adr/0004-wallet-rest-before-mcp.md) before implementation.

## Verified Wallet constraints and mandatory contract checkpoint

The current Wallet REST reference documents the fixed base URL
`https://rest.budgetbakers.com/wallet`, `Authorization: Bearer <token>`,
pagination with `limit` (max 200) and `offset`, initial-sync `409`, and `429`
with `Retry-After`. Write endpoints return a non-atomic summary plus
per-item results correlated by `inputIndex`; results distinguish `client_error`
from retryable `server_error`, and mixed batches may use `207`.

Before adding a live client call, inspect the current Wallet OpenAPI spec and
record the version/date, operation IDs, paths, required record fields, money
and date encodings, create batch maximum, writable-account representation,
category hierarchy rules, and whether a supported idempotency/correlation field
exists. Commit a versioned **sanitized public-schema fixture** plus tests. Do
not invent payload fields from this plan; if the spec conflicts, stop at the
adapter boundary, update this plan/tests, and get review.

## Fixed decisions

| Area            | Decision                                                                                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token           | Enter in a password field, submit only to loopback service, retain only in private active-session server state. Never return/display/log/export/store it, including browser storage, URL, snapshots, errors, `.env`, clear, shutdown, or credential replacement. |
| Remote boundary | Wallet is the only Phase 4 external origin. Server uses a fixed HTTPS origin, exact OpenAPI-confirmed operations, finite timeout/response bounds, and `redirect: 'manual'`. Browser never contacts Wallet.                                                       |
| Commit input    | Re-derive the Phase 3 projection server-side every time. Client rows, IDs, totals, category IDs, payloads, or account IDs are requests only. Reject containers, excluded/needs-review/stale items, missing category, and invalid splits.                         |
| Account         | User selects exactly one API-confirmed writable account. If the API cannot establish writability, refuse to write; never infer from account name.                                                                                                                |
| Categories      | Each distinct approved local `categoryName` needs exactly one explicit mapping to a current eligible Wallet category ID. Exact-name matching is only a suggestion; user selection plus server validation is required.                                            |
| Snapshot        | Dry-run stores an opaque immutable snapshot of derived leaf IDs/field hashes, review/history versions, token generation, catalog version, account, mappings, order, totals, and canonical payloads. Any input change invalidates it.                             |
| Money           | Keep signed integer `amountMinor` until a single adapter maps it to the OpenAPI schema. Never use a float or reverse the BDO expense sign by assumption.                                                                                                         |
| Retry           | Only explicit per-item Wallet `server_error` is retryable. Never automatically retry successes, client errors, unknown transport outcomes, or not-submitted records.                                                                                             |
| Sync/rate limit | Surface initial-sync `409`; write no further chunk. Honor `Retry-After` for `429` with bounded cancellable wait. Record safe sync/rate metadata; never promise immediate visibility.                                                                             |
| Export          | Journal/result data is active-session only. Default export excludes token/auth headers, source excerpts, description, payee, note, reference, raw remote bodies, and Wallet account/category labels.                                                             |

## User-visible flow

1. Wallet setup appears only after Phase 3 has eligible approved leaves and
   explains that this sends data externally.
2. User enters a token. The service validates it and loads bounded safe account
   and category projections; token is never echoed.
3. User selects a writable account and maps all local categories.
4. User creates a dry-run showing count, signed total, destination label,
   mapping coverage, records, split lineage, and **Not sent yet**.
5. User explicitly confirms the snapshot. Server prevents concurrent commits.
6. Results distinguish success, client error, retryable server error, unknown,
   and not submitted. Wallet IDs appear only for confirmed successes.
7. User can retry only server-error rows, download a redacted summary, or clear
   the session. Unknown outcomes require manual resolution; no resend control.

## Dependency order and boundaries

```text
P4.1 OpenAPI fixture + contracts/session state
  -> P4.2 fixed-base Wallet client and token/connectivity
  -> P4.3 account/category selection and mapping
  -> P4.4 canonical mapper and dry-run snapshot
  -> P4.5 batch executor and recovery journal
  -> P4.6 routes, typed API client, accessible UI
  -> P4.7 tests, docs, and release handoff
```

```text
HTTP commit routes -> commit service -> review handoff / mapper / journal
                                      -> Wallet client (fixed HTTPS base)
SessionStore <----- commit service
UI ---------------> typed local API client
```

No route/component may build a Wallet payload, retain a token, decide
retryability, or mutate the journal directly.

## P4.1 — Lock contracts and extend the ephemeral session

**Outcome:** Wallet data/payloads are runtime-validated before routes consume
them, and Phase 4 state shares the existing session lifecycle.

Create `src/server/wallet/` (`contracts.ts`, `client.ts`, `mapper.ts`,
`commitService.ts`, tests). Define strict Zod schemas for OpenAPI-derived
account/category projections, create requests, write envelope/results, and
safe API responses. Add `phase4` to `SessionEntry`: private token, token
generation, safe connection state, catalog/version, selection/mappings,
snapshot, bounded journal, and safe audit events. Do not expose the private
field through generic getters.

Use contracts equivalent to:

```ts
type WalletConnectionState =
  | 'not_configured'
  | 'ready'
  | 'initial_sync_pending'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable';
type CommitItemStatus =
  | 'ready'
  | 'submitting'
  | 'succeeded'
  | 'client_error'
  | 'server_error_retryable'
  | 'unknown'
  | 'not_submitted';
type WalletCategoryMapping = {
  localCategoryName: string;
  walletCategoryId: string;
  walletCategoryLabel: string;
  catalogVersion: string;
};
type CommitJournalEntry = {
  reviewItemId: string;
  sourceRowId: string;
  snapshotId: string;
  inputIndex?: number;
  status: CommitItemStatus;
  walletRecordId?: string;
  safeErrorCode?: string;
  attemptCount: number;
  updatedAt: string;
};
```

Use opaque IDs, bounded labels, ISO timestamps, integer centavos, and strict
objects. Success is terminal; only `server_error_retryable` may return to
`submitting`. Phase 1–3 changes invalidate selections/mapping/snapshot. After
any submission, retain confirmed journal results but invalidate pending
snapshots; never silently discard a known success.

**Exit criteria:** contract tests reject malformed remote envelopes, duplicate
or out-of-range indexes, missing success IDs, bad money, unknown fields, and
success-to-retry transitions; clear/shutdown tests erase Phase 4 state; fixture
tests fail if adapter operation/payload diverges from the recorded OpenAPI
fragment.

## P4.2 — Fixed-base client, ephemeral token, and discovery

**Outcome:** Only the local server can validate a supplied token and retrieve
the bounded metadata needed to commit.

Implement a narrow `WalletClient` and scripted fake. Insert the Bearer header
inside the production adapter only. Fixed origin/path allowlist, no URL/header
input from UI, no redirects, cancellation, timeout and response-size bounds are
mandatory. Paginate until `nextOffset` is absent, enforcing page/item limits;
validate all pages before atomically replacing the catalog.

Handle `401/403`, initial-sync `409` with retry minutes, `429`, malformed body,
timeout, and transport failure as distinct safe connection states. Retrying a
read after throttling is explicit/user-driven, never an infinite loop. Store
only IDs and bounded labels until session clear.

**Exit criteria:** unit tests cover auth insertion/redaction, fixed origin,
redirect rejection, cancellation, pagination, limits, 200/401/403/409/429,
malformed JSON, and timeout. Integration test proves browser never contacts the
fake Wallet service.

## P4.3 — Destination selection, explicit category mapping, eligibility

**Outcome:** Every required destination value is current and verified before a
dry-run exists.

Expose safe catalog projections only. Re-derive Phase 3 approved leaves and
require current `ready` state, one writable account, and exactly one valid
mapping for every distinct local category. Reject absent IDs, parent/group-only
categories when API disallows them, conflicting mappings, mappings for
categories outside the approved set, stale catalog, and any no-longer-eligible
review item. Exact normalized display-label suggestions are advisory only.

Catalog refresh/token replacement invalidates incompatible mappings and every
snapshot. Return coverage/counts, never full source/proposal evidence.

**Exit criteria:** tests cover zero writable accounts, removed/stale category,
hierarchy restrictions, mapping replacement, review/history conflicts, and
prove containers/unapproved/excluded/invalid splits cannot reach dry-run.

## P4.4 — Canonical mapper and immutable dry-run

**Outcome:** Confirmation can send only the records the reviewer inspected.

Implement one mapper from `ApprovedReviewItemForCommit` + account + mapping to
the OpenAPI-confirmed create item. It alone translates money/date/sign fields
and validates the exact create schema. Use a correlation field only if Wallet
documents it; otherwise correlate only in the session journal.

`POST /api/session/:id/wallet/dry-run` re-derives approved leaves, validates
selection/catalog, maps stable source order then split-child order, hashes the
canonical relevant fields with a session-only comparison digest, and stores an
opaque snapshot. Response has display projections, totals, coverage, and an
explicit no-network/no-send indication; it never reveals hidden payload fields.

**Exit criteria:** mapper tests reconcile the synthetic BDO 35 reviewed leaves
and PHP total without float arithmetic; exact payload fixture passes; changes to
review/history/token/catalog/account/mapping or a tampered/stale snapshot fail
confirmation; dry-run makes zero create calls.

## P4.5 — Batched commit, correct outcomes, and recovery

**Outcome:** Non-atomic Wallet responses cannot be misreported or resend known
successes in the active session.

`POST /api/session/:id/wallet/commit/:snapshotId` takes a per-session lock,
revalidates snapshot, marks selected rows `submitting`, and sends chunks no
larger than confirmed endpoint maximum. Correlate each chunk strictly by its
zero-based `inputIndex`; missing/duplicate/unexpected result indexes make the
affected chunk `unknown`. Persist in-memory journal transitions immediately
after each completed response.

Interpret the validated envelope rather than status alone: success →
`succeeded` plus Wallet ID; `client_error` → non-retryable; `server_error` →
retryable. Treat 200 all-success, mixed 207, all-failed 400/500 correctly.
On stop/cancel/rate-limit, later chunks are `not_submitted`. On timeout,
connection reset, invalid body, or interruption after dispatch, mark its chunk
`unknown` and never auto-resend. On 409 initial sync, halt later chunks. For
429 before a completed response, leave rows ready/not-submitted and expose a
bounded cancellable `Retry-After` wait.

`POST /api/session/:id/wallet/retry` accepts no row IDs; server selects only
`server_error_retryable` journal items. It cannot include success/client error/
unknown/not-submitted. A separate send-not-submitted action, if added, must
require a fresh dry-run—not be implied by Retry.

**Exit criteria:** fake-client integration covers multi-chunk success, mixed
207, all client/server errors, 429 among chunks, 409, malformed results,
cancellation, timeout unknown, and simultaneous confirmation. Tests prove
retry sends only explicit server errors and result counts reconcile exactly.

## P4.6 — Safe API surface and accessible commit UI

**Outcome:** User can understand every external action and result.

Add strict, bounded routes such as:

```text
POST /:id/wallet/connect                 # token; never echoed
GET  /:id/wallet/setup                   # safe setup/catalog state
POST /:id/wallet/selection               # account + explicit mappings
POST /:id/wallet/dry-run
POST /:id/wallet/commit/:snapshotId
POST /:id/wallet/retry                   # server-selected rows only
GET  /:id/wallet/results
GET  /:id/wallet/result-summary-export
POST /:id/wallet/disconnect              # erase token/setup; retain journal
```

Use existing safe error envelopes and typed additions to `src/client/api.ts`.
Do not accept base URL/custom headers. Build Wallet setup → mapping → dry-run
→ confirmation dialog → results into `App.tsx`; keyboard-accessible tables,
focus management, live status, cancellable throttle waits, and empty/loading/
error states are required. Confirmation must name destination, record count,
signed total, and irreversibility. Never show optimistic success.

Generate `wallet-import-results.csv` in memory. Deterministic columns: safe
session/item/source/review IDs, status, successful Wallet ID, safe error code,
attempt count, timestamp, and aggregate counts. Exclude token, auth headers,
descriptions, payees, notes, references, raw bodies, and account/category
labels.

**Exit criteria:** routes/client tests cover malformed requests, missing/
cleared session, stale snapshot, lock conflict, token redaction, and exports.
E2E covers fake mixed outcomes and retry eligibility with no browser token or
payload persistence. Accessibility tests cover mapping, dialog, results,
announcements, and export.

## P4.7 — Verification, docs, and handoff

**Outcome:** The phase is reproducible entirely with synthetic data and safe
to maintain.

Add only synthetic OpenAPI/fake-Wallet fixtures: paginated accounts/categories,
payloads, mixed envelopes, throttle, sync pending, malformed responses. Update
README, SECURITY, CONTRIBUTING, `.env.example`, and the master tracker with
the external-network exception, token lifetime, mapping/snapshot semantics,
sync caveat, result terms, and unknown no-resend policy. `.env.example` must
state that Wallet tokens are not configured via environment variables.

Run `npm run check`, Wallet unit/integration/E2E/privacy tests, and fake-client
call-order/payload tests. Block all other external destinations and prove no
create occurs before confirmation.

## Definition of done

1. The BDO Phase 3 fixture produces exactly 35 approved leaves, fully maps them,
   and dry-runs a centavo-exact total without floating-point arithmetic.
2. Token is server-session-only and absent from all responses, logs, exports,
   browser storage, URLs, fixtures, clear, and shutdown state.
3. No create request happens before explicit current-snapshot confirmation;
   changing input invalidates confirmation.
4. Mixed results are per-item accurate; no batch is called successful merely
   because HTTP returned or some items succeeded.
5. Same-session retry submits only confirmed retryable errors; successes and
   unknowns are never automatically resent.
6. User can inspect Wallet IDs/errors, understand sync delay, and export a
   redacted local summary before clearing.

## Phase 5 handoff

Phase 5 may polish onboarding, responsiveness, accessibility, public docs, and
release assets. It must preserve the ephemeral-token, explicit-mapping,
snapshot, recovery-journal, and no-automatic-resend guarantees in this plan.
