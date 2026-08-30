> **Sensitive-data / security attestation:** I confirm this PR contains no real statement, Wallet export, prompt, token, OCR artifact, financial screenshot, or diagnostic bundle with financial data. Synthetic fixtures only; synthetic binary fixtures are explicitly allowlisted after provenance review. For security fixes, follow `SECURITY.md` (private report).

## Summary

What does this PR change and why?

## Checklist

- [ ] `npm run check` passes (format, lint, typecheck, unit/integration/component tests, `npm run test:e2e`, `npm run eval`, `npm run benchmark`, `scan:secrets`, `scan:repository`, `scan:demo`, `scan:external`, `audit`, `build`)
- [ ] Tests are fixture-driven and do not require a real statement, Wallet export, token, model, or Internet connection after `npm ci`
- [ ] Docs updated and links checked (`README.md` links to runbooks rather than duplicating contracts)
- [ ] Synthetic fixtures have provenance and `.gitignore` allowlist; no redacted real data
- [ ] No new external origin, analytics, remote fonts/CDNs, cloud model, or browser-to-Wallet path added (verified by `scan:external`)
- [ ] Added parser/provider guide steps were followed if applicable (`docs/guides/parser-authoring.md`, `model-provider-authoring.md`)

## Testing

- [ ] Unit / integration / component / E2E evidence (include commands and fixture IDs)
- [ ] Verified demo works offline through review with network disabled; no demo request reaches Wallet or model endpoint
- [ ] Accessibility: keyboard and responsive checks done (see `docs/benchmarks/accessibility-checklist.md`)

## Screenshots (optional, synthetic only)

Attach only synthetic, clearly labelled screenshots.
