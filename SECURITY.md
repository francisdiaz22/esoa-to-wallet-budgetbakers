# Privacy and Security

## Processing boundary

The application is local-first. The browser UI and backend bind to loopback
addresses, and statement contents are not sent to a hosted service. Local model
providers must also use a loopback endpoint. Wallet REST is the only planned
network boundary for approved transaction writes.

## Data lifetime

Uploaded statements, imported history, OCR text, prompts, model responses,
Wallet API responses, review items, duplicate groups, audit events, and redacted
summaries exist only for the active session. The application does not maintain
a transaction database or automatic long-term cache. Large-document support may
use an encrypted, session-scoped temporary workspace; it must be removed when
the session is cleared or the process exits.

Crash handlers and logs must never serialize statement contents, prompts,
credentials, raw API responses, review payees/notes, or transaction fields.
Review audit events store only safe, bounded metadata (state/category names,
fixed reasons, counts, IDs) and never raw excerpts, free-text notes, history
text, or model replies. The redacted export excludes descriptions, payees,
notes, references, and rationale. Temporary-workspace implementation and
verified cleanup are Phase 1 requirements.

## Telemetry

Telemetry, analytics, remote error reporting, and usage tracking are disabled by
default. A future diagnostic export must be explicit, local, previewable, and
redacted by default.

## Credentials

Wallet API tokens are entered at runtime via a password field and submitted
only to the loopback service. They remain only in private active-session server
state (never returned/displayed/logged/exported/stored in browser storage, URL,
snapshots, errors, `.env`, clear, shutdown, or credential replacement). The
fixed HTTPS origin `https://rest.budgetbakers.com/wallet` is the only Phase 4
external origin; browser never contacts Wallet. Operating-system credential
storage requires a separate explicit opt-in design.

`.env` files are for non-secret local configuration during this phase.
`.env.example` contains names and safe defaults only and explicitly states that
Wallet tokens are not configured via environment variables.

## Wallet commit and recovery

Phase 4 sends the exact, server-derived Phase 3 `ApprovedReviewItemForCommit`
set to Wallet with explicit per-item recovery journal. Review remains authoritative.
The dry-run stores an opaque immutable snapshot (leaf IDs/hashes, versions, token
generation, catalog version, account, mappings, order, totals, canonical payloads);
any input change invalidates it. Money is kept as signed integer `amountMinor`
until a single adapter maps it. Only `server_error` is retryable; `client_error`,
`unknown`, `not_submitted`, and successes are never automatically resent. A write
timeout is `unknown`, never permission to resubmit. `409` initial-sync halts writes
and `429` honors `Retry-After` with bounded cancellable wait. Results distinguish
`succeeded` (Wallet ID present), `client_error`, `server_error_retryable`,
`unknown`, and `not_submitted`. Journal/result data is active-session only;
default export excludes token, auth headers, descriptions, payees, notes,
references, raw remote bodies, and labels, and never promises immediate visibility.

## Fixture and redaction policy

Only clearly labeled, genuinely synthetic financial fixtures may be committed.
Redacted real statements and exports remain private because merchant, date,
amount, pattern, and metadata can still identify a person. Synthetic fixtures
must use fake account/card/reference data and have unnecessary metadata removed.

The BDO fixture images in `fixtures/synthetic/bdo/` were explicitly confirmed by
the project owner as synthetic and are path-allowlisted. Their CSV oracles are
validated by automated reconciliation tests.

## Repository defenses

The repository uses deny-by-default ignore rules for financial file types,
explicit synthetic-fixture allowlists, an automated tracked-file policy check,
a secret-pattern scan, dependency auditing, and CI. These controls reduce risk
but do not replace review before staging a file.

## Reporting a vulnerability

Do not place sensitive evidence in a public issue. Contact the repository owner
privately with a minimal reproduction and no real financial data. If a token was
exposed, revoke and rotate it before investigating further.
