# eSOA to Wallet

A local-first web application for converting electronic statements of account
into reviewed transactions for Wallet by BudgetBakers.

The application will extract statement rows, suggest categories using a local
model and imported Wallet history, provide a human review step, and submit only
approved transactions through the Wallet REST API. Financial data stays on the
user's machine and telemetry is disabled by default.

> **Current status:** Phase 0 repository and safety foundation. Statement
> ingestion starts in Phase 1; the current UI and API are a runnable scaffold.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git

No statement, Wallet export, API token, local model, or network connection is
needed after dependencies have been installed.

## Start locally

```sh
git clone <repository-url>
cd esoa-to-wallet-budgetbakers
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:4300>. The browser UI proxies API requests to the local
service at <http://127.0.0.1:4310>. Both development services bind only to the
loopback interface.

## Quality commands

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run scan:secrets
npm run scan:repository
npm run audit
npm run build
```

Run the complete non-mutating project gate with:

```sh
npm run check
```

Use `npm run format` to apply formatting before rerunning the gate.

## Synthetic fixtures

The reviewed BDO fixture set is under `fixtures/synthetic/bdo/`:

- Three approved synthetic statement images.
- `expected_extraction.csv`: the Phase 1 one-row-per-charge oracle, with 33
  included charges and four excluded statement rows.
- `wallet_records_synthetic.csv`: 35 post-review Wallet rows. Two source charges
  are intentionally split, and all rows reconcile to PHP 34,957.17.

All fixture values are synthetic. Real statements, screenshots, history
exports, OCR output, and tokens are ignored by default. Adding a new synthetic
fixture requires an explicit `.gitignore` allowlist entry and reviewer
confirmation of its provenance.

## Architecture and privacy

The browser UI talks to a Node.js service bound to `127.0.0.1`. Future document
parsers, OCR engines, local-model providers, and the Wallet client will be kept
behind replaceable interfaces. Session state is ephemeral; there is no
transaction database.

Read [SECURITY.md](SECURITY.md) before handling a statement or credential. Key
architectural decisions are recorded in [docs/adr](docs/adr), and the complete
delivery plan is in [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never open an issue or pull request with
a real statement, Wallet export, prompt, token, OCR artifact, or screenshot of
financial data.

## Wallet integration

Wallet REST is the first write integration. A Wallet Premium user supplies a
token at runtime and selects a writable account before committing approved
records. MCP is deferred to later reporting and custom workflows.

- REST reference: <https://rest.budgetbakers.com/wallet/reference>
- Wallet MCP endpoint: <https://mcp.wallet.budgetbakers.com>
