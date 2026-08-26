# ADR-0002: Ephemeral temporary-data policy

- Status: Accepted
- Date: 2026-08-26

## Context

OCR and large documents may need temporary disk space, but persistent financial
data conflicts with the project's privacy goal.

## Decision

Keep session state in memory. Permit only encrypted, session-scoped temporary
files when necessary, and delete them on explicit clear and normal process exit.
Do not maintain a transaction or history database.

## Consequences

A terminated session cannot be resumed automatically. Phase 1 must define the
encryption, ownership, cleanup, crash-recovery, and stale-file removal behavior
before temporary workspaces process user data.
