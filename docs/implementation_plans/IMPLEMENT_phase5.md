# Phase 5 implementation runbook — product polish, extensibility, and public release

## Purpose and completion boundary

Phase 5 turns the Phase 1–4 local workflow into a trustworthy open-source release: a new user can evaluate it safely, and a contributor can extend it without reverse engineering private implementation details.

```text
onboard -> import -> local categorization -> review -> optional explicit Wallet commit
       -> redacted result/export -> clear session
```

The release must work without a real statement, Wallet export, token, local model, or network connection. The demo uses only committed, clearly labelled synthetic fixtures and stops before any Wallet write.

Out of scope: a transaction database, cloud processing, analytics, new bank parsers, a new model provider, cross-Wallet duplicate matching, background work, unattended commits, or new Wallet API capabilities. Fix a release-blocking defect when found, but change a Phase 1–4 contract only with an ADR and an update to its owning runbook.

Read IMPLEMENTATION.md, IMPLEMENT_phase1.md through IMPLEMENT_phase4.md, SECURITY.md, and CONTRIBUTING.md before implementation.

## Fixed decisions

| Area              | Decision                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public data       | Docs, demo media, examples, issue reports, fixtures, and diagnostic bundles use synthetic data only. Redacted real data is prohibited.                   |
| Onboarding        | Guidance is keyboard-operable and derives from active session state. It does not persist completion or configuration.                                    |
| Demo              | A local synthetic demo cannot contact Wallet and visibly labels every record as synthetic.                                                               |
| External services | Do not add analytics, hosted error reporting, remote fonts/CDNs, cloud models, or new origins. Wallet remains the only optional runtime external origin. |
| Accessibility     | Meet WCAG 2.2 AA where applicable: semantic controls, keyboard use, visible focus, status announcements, contrast, and reflow.                           |
| Diagnostics       | Optional, explicit, previewable, local-only, redacted by default, and never automatically attached or uploaded.                                          |
| Versioning        | Use SemVer. Remain 0.x until a stable public contract is deliberately declared; breaking changes still increment the minor version.                      |
| Release authority | Release only from a clean reviewed commit after all gates pass. Do not auto-publish or auto-tag.                                                         |

## User-visible release experience

1. A user sees a concise local-processing notice and a next-step onboarding panel.
2. They can run a credential-free offline synthetic demo through extraction, categorization, and review. The Wallet boundary is visibly disabled and explained.
3. Live setup is clear: import statement, import history, configure/test loopback model, review/approve, then optionally provide a runtime Wallet token and explicitly confirm a dry-run.
4. Loading, empty, failure, blocked, and completion states provide a safe next action and never show credentials, document contents, paths, prompts, or raw remote responses.
5. A contributor can add a parser or provider using fixture-driven guides without a private statement or service account.

## Dependency order and ownership boundaries

```text
P5.1 public-data inventory and release baseline
  -> P5.2 onboarding and offline demo
  -> P5.3 accessibility and responsive UX
  -> P5.4 documentation and extension guides
  -> P5.5 optional redacted diagnostics
  -> P5.6 reproducible benchmarks
  -> P5.7 governance and release workflow
  -> P5.8 verification and handoff
```

```text
UI onboarding -> typed local API -> existing loopback routes
demo runner   -> existing services/fixtures; no production bypass
diagnostics   -> bounded redacted session-safe projections
docs/CI       -> existing npm scripts and repository policy
```

Phase 5 consumes existing extraction, categorization, review, and Wallet contracts. No demo or client code may rebuild payloads, bypass validation/approval/dry-run, retain a token, or decide Wallet retryability.

## P5.1 — Public-data inventory and release baseline

**Outcome:** An auditable definition of public-safe content and a known-good baseline exist before polish work.

1. Inventory committed fixtures, screenshots, recordings, documentation examples, test artifacts, log fixtures, and generated reports.
2. Verify each is non-financial or genuinely synthetic with provenance. New synthetic binary fixtures need an explicit .gitignore allowlist; never broaden ignores to make a fixture pass.
3. Inspect browser build/runtime for remote font, image, script, telemetry, source-map upload, and browser-to-Wallet paths. Reject anything that bypasses the existing local-first boundary.
4. Record baseline: Node version, lockfile integrity, test counts, evaluation metrics, bundle size, browser version, and known limitations.
5. Add a conservative automated guard for demo assets: required synthetic labels and forbidden credential/statement patterns. Existing secret and repository scans remain authoritative.

**Exit criteria:** An independent reviewer can trace each public financial example to a synthetic source; clean-checkout README commands work; no browser build calls an external origin before the explicit Phase 4 Wallet action.

## P5.2 — Guided onboarding and offline synthetic demo

**Outcome:** A first-time evaluator can safely exercise the workflow without private input or external setup.

Create a state-derived component, preferably under src/client/onboarding. It can use active-session server state and local component state only. Steps:

1. Explain local processing and supported statement formats.
2. Import a statement or load the synthetic demo.
3. Import Wallet history.
4. Configure/test a loopback model; explain that manual review remains possible if unavailable.
5. Review and approve proposals.
6. Only after approval, explain optional Wallet setup, external data sharing, and explicit confirmation.

Requirements:

- Use Phase 1–4 safe state/error codes. Never claim a model or Wallet connection is configured when it is not.
- Keep local lifetime, clear-session action, and optional Wallet boundary visible but concise.
- A dismissed guide reappears after refresh or session clear. Do not add browser storage just to remember dismissal.
- Load synthetic demo uses allowlisted/versioned fixtures and normal parsing, history, categorization, and review paths (or an existing provider-interface fake). It cannot upload data remotely or accept a Wallet token.
- Banner and demo exports say: Synthetic demo data — not a financial record.
- Wallet setup/commit is unavailable with an explanation, not hidden.
- Clear uses the normal session cleanup path.

Add npm run demo only if it is offline, non-interactive, uses production boundaries, and never alters fixtures or writes a config/token file. Otherwise document npm run dev plus the UI action.

**Exit criteria:** A clean clone runs the demo through review with network disabled. Playwright covers demo start, banner, review action, blocked commit, and clear. No demo request reaches Wallet or a model endpoint.

## P5.3 — Accessibility, responsive layout, and interaction resilience

**Outcome:** Import, review, and commit remain usable by keyboard, assistive technology, narrow windows, and during failures.

Audit file import, model setup, history import, review table/detail drawer, split editor, dry-run confirmation, rate-limit wait/cancel, results export, and clear-session confirmation.

- Use semantic buttons, labels, table headers, form-error associations, and native controls where possible.
- Give dialogs/drawers logical focus transfer; Escape closes a dismissible surface without losing unsaved edits. Commit confirmation is explicit and focus-contained.
- Announce asynchronous changes through bounded aria-live status/error regions without repeating transaction content or credentials.
- Pair state colours with text/icons and meet contrast requirements.
- At 320 CSS pixels and 200% zoom, retain all actions and values. A review table may become labelled cards, but cannot omit category, amount, state, issue, or source details.
- Define stable empty/loading/error/retry copy. Show safe server codes, never stacks. Disable busy mutations and duplicate submission.
- Respect prefers-reduced-motion; animation cannot be the only progress signal.

Use component/semantic tests and real-browser keyboard journeys. Perform a manual VoiceOver smoke test on synthetic data and record only a non-sensitive pass/fail checklist.

**Exit criteria:** Keyboard Playwright covers import → review edit → approval → dry-run → confirmation/results with fake Wallet responses; no critical axe-equivalent failures remain; responsive and screen-reader checks are documented.

## P5.4 — Documentation and extension guides

**Outcome:** New users and contributors can work safely without private knowledge.

Update README.md with scope, privacy boundary, support status, quick start, synthetic demo, local-model options, review/commit safety, commands, and limitations. Link to runbooks rather than duplicating contracts.

Create:

- docs/guides/parser-authoring.md: registry contract, recognition, normalization/exclusion/continuations, traceability, integer money/date rules, synthetic fixture provenance/allowlist, oracle construction, precision/recall, tests, and safe rejection of unsupported layouts. Explicitly prohibit redacted real statements.
- docs/guides/model-provider-authoring.md: provider interface, loopback enforcement, bounded request projection, schema validation, timeout/cancellation/failure, unknown/low-confidence behavior, test fake, and no direct review/Wallet authority.
- docs/guides/operations-and-troubleshooting.md: error-code recovery for imports, provider connection, review, Wallet initial sync/rate limit/mixed results, and unknown writes. State unknown writes are never auto-resent.
- docs/benchmarks/README.md: benchmark index/methodology and synthetic-data limits.

Expand CONTRIBUTING.md with layout, required checks, fixture policy, documentation expectations, and a testing matrix. Add issue/PR templates that warn about sensitive data and direct security reports to SECURITY.md.

**Exit criteria:** A contributor can follow the parser guide in a temporary branch with a copied synthetic fixture and pass its checklist; an automated link check passes; docs contain no real token, account, statement, or prompt.

## P5.5 — Optional redacted diagnostic bundle

**Outcome:** A user can supply useful diagnostics without default financial-data disclosure.

Do this after P5.1–P5.4. Present explanation, preview, and local download. Never auto-create a bundle.

Allowed contents: app/browser/Node/OS-family versions without unique identifiers; feature/version flags; non-sensitive limits; parser/provider adapter IDs but not endpoints; pipeline stage, safe issue codes, bounded counts/timing buckets/state transitions; report version; Wallet result-status counts; and a manifest explaining omissions/deletion.

Exclude document/history bytes, OCR, excerpts, transaction fields, descriptions, dates, amounts, balances, references, payees, notes, categories, prompts, model replies, URLs, paths, IPs, tokens, headers, Wallet IDs, remote bodies, session IDs, and free-text input. Do not hash sensitive values. Use strict schemas, field and total-size limits, in-memory generation, and a browser download only.

**Exit criteria:** Snapshot/schema tests prove prohibited fields absent even when session state contains them; adversarial secret/statement strings cannot leak; download is explicit, previewable, local-only, and not persisted by the app.

## P5.6 — Reproducible benchmark report

**Outcome:** Public claims are measured and qualified.

Build on npm run eval and versioned synthetic fixtures. Add deterministic reporting (for example npm run benchmark) that commits Markdown/JSON generated only from synthetic fixtures or emits a CI artifact; choose and document one. Never run real-statement benchmarks in CI.

Report:

- extraction count, precision, recall, F1, excluded-row reconciliation, parser/version/format, and fixture limits;
- classification total, coverage, precision-among-proposed, unknown, malformed/unavailable, category support, and confidence calibration;
- duplicate exact/near/non-duplicate, split-centavo reconciliation, and commit-eligibility invariants;
- fake Wallet all-success, mixed, throttle, initial-sync, timeout/unknown, retryable error, and no-resend results;
- timing percentiles for extraction, baseline categorization, review initialization, and fake Wallet mapping, with hardware/Node/fixture/warm-cold/iteration methodology and non-guarantee statement;
- limitations: fixture-backed formats, synthetic bias, local-model/OCR variance, no cross-session idempotency, no cross-Wallet duplicate matching.

Use integer centavos and deterministic fake providers for correctness. Manual local-model benchmarking is optional and cannot be release gating.

**Exit criteria:** Two runs on the same revision yield identical correctness metrics/schema; CI validates report sections/fixture counts; README claims link to the report and qualify results.

## P5.7 — Governance and release workflow

**Outcome:** The repository has the necessary public-project controls.

1. Ask the owner to select a license before adding LICENSE. Do not select one. Then add canonical license text and SPDX metadata as appropriate.
2. Ask the owner for code-of-conduct contact/enforcement preferences before adding CODE_OF_CONDUCT.md. Do not expose private contact details without approval.
3. Add CHANGELOG.md with Keep-a-Changelog-style sections and documented pre-1.0 SemVer policy. State capability and limits accurately.
4. Add GitHub issue/PR templates with a prominent synthetic-data/security warning, reproduction/test/privacy checklist, and no-token/no-statement attestation.
5. Add a manual release workflow/document: clean-tree check; npm ci; full check/audit/build; synthetic demo; accessibility checklist; benchmark; dependency review; changelog/version review; tag/release notes; post-release clean-clone verification. Do not add auto-publish unless specifically authorized.

**Exit criteria:** Governance documents reflect owner-confirmed choices; a dry-run release checklist passes on a clean clone; release notes accurately state parser/provider support, external boundaries, and limitations.

## P5.8 — Final verification and handoff

**Outcome:** Another agent can validate a release candidate from the repository alone.

From a clean checkout with no .env, real fixture, token, or model runtime run:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run eval
npm run scan:secrets
npm run scan:repository
npm run audit
npm run build
```

Run the offline demo and its smoke test with all non-loopback network blocked. Use fake Wallet responses for confirmation/results; no live token or write is needed. Review git diff --check, tracked files, report policy, doc links, and checklist evidence.

Handoff includes exact commit SHA and lockfile state; commands/results; accessibility/browser matrix and non-blockers; benchmark path/version/fixture IDs; demo instructions; supported parsers/providers/deferred scope; and confirmation that validation used no real financial data, token, or live Wallet write.

## Completion criteria and release blockers

Complete only when the demo works offline through review; onboarding preserves all Phase 1–4 safety; core flows pass keyboard/responsive/error tests plus manual accessibility smoke; extension/support docs are independently usable; diagnostics are explicit/redacted/test-proven; claims are reproducible and limited; owner-approved governance/release workflow exists; and the full validation matrix passes.

Release blockers:

- Real or insufficiently proven synthetic financial data in Git, docs, screenshots, tests, or demo assets.
- Browser-side Wallet access, non-loopback model traffic, telemetry, or an unreviewed external origin.
- A demo that can send Wallet writes, bypass approval, or persist sensitive inputs.
- Keyboard barriers in import, review, confirmation, results, or clear-session workflows.
- Claims of unsupported banks/providers or guarantees around mixed/unknown Wallet outcomes.
- A diagnostic artifact containing sensitive content or generated without explicit user action.

Record other work as scoped follow-ups rather than silently expanding the release.
