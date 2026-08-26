# ADR-0004: Wallet REST before MCP

- Status: Accepted
- Date: 2026-08-26

## Context

Transaction import needs deterministic payloads, per-row results, controlled
retry behavior, and an auditable approval boundary.

## Decision

Use Wallet REST for v1 transaction commits. Enter its token at runtime, select a
writable destination account, show an exact dry run, and submit approved rows
only. Defer MCP to reporting and custom workflows.

## Consequences

The REST client must handle mixed results, throttling, delayed synchronization,
and active-session idempotency. MCP does not block extraction or review work.
