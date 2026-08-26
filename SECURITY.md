# Privacy and Security

## Processing boundary

The application is local-first. The browser UI and backend bind to loopback
addresses, and statement contents are not sent to a hosted service. Local model
providers must also use a loopback endpoint. Wallet REST is the only planned
network boundary for approved transaction writes.

## Data lifetime

Uploaded statements, imported history, OCR text, prompts, model responses,
Wallet API responses, and review state exist only for the active session. The
application does not maintain a transaction database or automatic long-term
cache. Large-document support may use an encrypted, session-scoped temporary
workspace; it must be removed when the session is cleared or the process exits.

Crash handlers and logs must never serialize statement contents, prompts,
credentials, raw API responses, or transaction fields. Temporary-workspace
implementation and verified cleanup are Phase 1 requirements.

## Telemetry

Telemetry, analytics, remote error reporting, and usage tracking are disabled by
default. A future diagnostic export must be explicit, local, previewable, and
redacted by default.

## Credentials

Wallet API tokens are entered at runtime. They must remain in active-session
memory, must never enter browser persistence, source control, URLs, logs, error
messages, prompts, or diagnostic output, and must be cleared with the session.
Operating-system credential storage requires a separate explicit opt-in design.

`.env` files are for non-secret local configuration during this phase.
`.env.example` contains names and safe defaults only.

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
