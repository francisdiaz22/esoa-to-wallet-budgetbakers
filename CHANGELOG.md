# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Pre-1.0 policy: remain `0.x` until a stable public contract is deliberately declared; breaking changes still increment the minor version. See `package.json` version and `docs/benchmarks/report.json` for current state.

## [0.5.0] — 2026-08-30 — Product polish, extensibility, and public release (Phase 5)

### Added

- Guided onboarding (state-derived, not persisted) covering local processing, statement/history/model/review/Wallet steps; local-lifetime and clear-session visibility; dismissed guide reappears after refresh/clear.
- Offline synthetic demo (`POST /api/demo`) — credential-free, uses versioned synthetic fixtures and normal parsing/history/categorization/review paths, banner `Synthetic demo data — not a financial record`, Wallet boundary visibly disabled, Wallet commit blocked.
- Accessibility pass: semantic controls, visible focus, focus trap/return for drawers/dialogs, Escape handling, bounded aria-live regions, contrast-compliant pairings, 320px + 200% zoom reflow (table → labelled cards), `prefers-reduced-motion` support, keyboard coverage for import → review → dry-run → confirmation.
- Extension guides: `docs/guides/parser-authoring.md`, `model-provider-authoring.md`, `operations-and-troubleshooting.md`; `docs/benchmarks/README.md` with index/methodology/limits.
- Optional redacted diagnostics: explicit preview (`GET /:id/diagnostics/preview`) + local download (`GET /:id/diagnostics/download`), strict schemas, size-limited in-memory generation, never auto-attached/uploaded.
- Reproducible benchmarks: `npm run benchmark` generates `docs/benchmarks/report.{json,md}` from synthetic fixtures (extraction, classification, duplicates, fake Wallet scenarios, timing percentiles), deterministic on same revision.
- Governance: `LICENSE` (MIT, SPDX), `CODE_OF_CONDUCT.md` (placeholder contact pending owner confirmation), issue/PR templates with synthetic-data/security warning, manual release workflow.

### Changed

- Browser build verified to call no external origin before explicit Wallet action; Wallet remains the only optional runtime external origin (`https://rest.budgetbakers.com/wallet`).
- UI clarifies local-processing notice and next-step onboarding panel before any import.

### Fixed

- Demo asset guard (`scripts/check-demo-assets.mjs`) and external-origin guard (`scripts/check-external-origins.mjs`).

### Limitations (still synthetic-only)

- Fixture-backed BDO Visa Gold PHP image only; synthetic bias; no cross-Wallet duplicate matching; no persistent DB.

## [0.4.0] — 2026-08-30 — Wallet REST commit and recovery

- Ephemeral Bearer token (server-session only, fixed `https://rest.budgetbakers.com/wallet` origin, no browser contact), paginated account/category discovery, explicit writable-account and per-local-category mapping, immutable dry-run snapshot (hash-validated, `Not sent yet`), batched non-atomic commit with per-`inputIndex` correlation, `207` mixed-result handling, journal with `succeeded`/`client_error`/`server_error_retryable`/`unknown`/`not_submitted`, server-selected retry only for `server_error_retryable`, `409`/`429` handling, redacted `wallet-import-results.csv`.

## [0.3.0] — 2026-08-30 — Validation, duplicate detection, and HITL review

- Review workspace with deterministic duplicate detection, centavo-exact splits, audit, return-to-review, targeted re-categorization, bulk approve, redacted `review-summary.csv`, `ApprovedReviewItemForCommit` projection.

## [0.2.0] — 2026-08-30 — Wallet history import and local categorization

- History import, catalog, deterministic retrieval, loopback OpenAI-compatible adapter with DNS-rebinding mitigation, categorization orchestration, evaluation harness.

## [0.1.0] — 2026-08-29 — Statement ingestion and normalized extraction

- Ingestion adapters, BDO parser `bdo-visa-gold-ph-image-v1`, 33-row oracle, encrypted workspace.

---

Unreleased changes should be added above and will be moved to a version section during a manual release (clean-tree check, `npm ci`, full `check/audit/build`, demo, a11y checklist, benchmark, dependency/changelog/version review, tag, post-release clean-clone verification).
