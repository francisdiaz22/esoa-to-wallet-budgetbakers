# Release workflow (manual, owner-approved)

No auto-publish or auto-tag is configured. A release is a clean reviewed commit after all gates pass.

## Prerequisites

- License already selected (`LICENSE` MIT, SPDX `MIT`) and `CODE_OF_CONDUCT.md` contact confirmed by owner (placeholder must be replaced before public release).
- All Phase 5 polish is complete: onboarding derives from active session, demo works offline through review with banner, Wallet visible-but-disabled in demo, accessibility/responsive/error states correct, docs/guides reproducible, diagnostics is explicit/previewable/local-only/redacted, benchmarks reproducible, and full `npm run check` passes.

## Manual release checklist

From a clean clone with no `.env`, real fixture, token, or model runtime:

```sh
git status # must be clean
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run eval
npm run benchmark
npm run scan:secrets
npm run scan:repository
npm run scan:demo
npm run scan:external
npm run audit
npm run build
```

Additional manual verification:

1. **Synthetic demo offline:** `npm run dev` + click **Load synthetic demo** with all non-loopback network blocked. Verify through extraction → history → categorization → review (approve one, split, export labelled `Synthetic demo data — not a financial record`) → Wallet shows blocked explanation, not hidden. No request reaches Wallet or a model endpoint (check Playwright coverage: `e2e/demo.spec.ts` — demo start, banner, review action, blocked commit, clear). `GET /api/demo/:id/status` returns `isDemo:true`.
2. **Accessibility smoke:** Import → review edit → approval → dry-run → confirmation/results keyboard-only with fake Wallet responses; run axe-equivalent checklist; verify 320 CSS pixels + 200% zoom retains all actions/values (table becomes labelled cards). Record manual VoiceOver pass/fail checklist (no sensitive data).
3. **Diagnostics:** Preview + download produces bounded JSON (<64 KiB), contains no prohibited fields even when session state contains them, adversarial secret strings do not leak, and is explicit/local-only/not persisted.
4. **Benchmark artifact:** `docs/benchmarks/report.json/md` committed or attached to CI artifact; two runs on same revision yield identical correctness metrics/schema; `npm run benchmark` validates sections/fixture counts.
5. **Dependency review:** `npm audit`, lockfile integrity (`npm ci` clean), bundle size (`dist` ~ 260 KiB JS, `dist-server` ~1 MiB).
6. **Changelog/version review:** `CHANGELOG.md` (Keep-a-Changelog) documents 0.x SemVer policy; `package.json` version bumped appropriately; notes state parser/provider support (`bdo-visa-gold-ph-image-v1` only), external boundaries, and limitations (synthetic bias, no cross-Wallet duplicate matching, no persistent DB, single currency PHP).
7. **Docs link check:** `README.md` quick start + demo + commands + limitations link to runbooks and `docs/guides/*`; no real token/account/statement/prompt in docs.
8. **Tracked files & report policy:** `git diff --check`, `git ls-files`, policy check `npm run scan:repository`; no real financial example in Git, docs, screenshots, tests, or demo assets.

## Tag and release notes

```sh
git tag v0.5.0 -m "v0.5.0 — Phase 5 product polish, extensibility, and public release"
git push origin v0.5.0
# Create GitHub Release from tag using CHANGELOG.md section as notes
gh release create v0.5.0 --title "v0.5.0 — Phase 5" --notes-file CHANGELOG.md
```

Release notes must accurately state supported parsers/providers (`bdo-visa-gold-ph-image-v1` + loopback OpenAI-compatible), external boundaries (Wallet `https://rest.budgetbakers.com/wallet` only after explicit confirmation; browser never contacts Wallet; demo cannot), and limitations (synthetic bias, local-model/OCR variance, no cross-session idempotency).

## Post-release clean-clone verification

After tagging, from a separate clean clone run the full verification matrix again and confirm the tag SHA matches the handoff SHA and lockfile state; record commands/results and demo/binding evidence in the release issue.

## Handoff

Handoff includes exact commit SHA and lockfile state; commands/results; accessibility/browser matrix and non-blockers; benchmark path/version/fixture IDs; demo instructions; supported parsers/providers/deferred scope; and confirmation that validation used no real financial data, token, or live Wallet write.
