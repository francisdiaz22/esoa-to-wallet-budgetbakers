# Contributing

## Local setup

Install Node.js 22 or newer, then run:

```sh
npm ci
cp .env.example .env
npm run dev
```

Before submitting a change, run `npm run check`, `npm run audit`, and
`npm run build`.

## Financial-data safety

- Use synthetic fixtures only. Redaction alone does not make a real statement
  suitable for the repository.
- Do not commit statements, Wallet history exports, prompts, OCR output, API
  responses, tokens, session files, diagnostic bundles, or financial
  screenshots.
- A synthetic binary fixture must receive an explicit path allowlist in
  `.gitignore` after a reviewer confirms its provenance and checks its metadata.
- Use obvious fake identifiers, accounts, names, references, and barcodes.
- Revoke a credential immediately if it enters Git history and report it using
  the private process in `SECURITY.md`.

## Pull requests

Keep changes scoped, add fixture-driven tests, and explain privacy implications.
Pull requests must pass formatting, linting, strict type checking, unit tests,
the dependency audit, the repository safety scan, and secret scanning.
