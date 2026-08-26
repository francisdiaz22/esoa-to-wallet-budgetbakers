# Implementation Plan

## 1. Product definition

Build a local-first web application that converts a user's electronic statement of account (eSOA) into reviewed Wallet by BudgetBakers transactions.

The application must:

1. Import bank statements in PDF, image, or CSV form.
2. Extract transactions into a normalized, traceable format.
3. Categorize transactions with a user-selected local LLM, using a locally imported Wallet history as examples.
4. Present a human-in-the-loop (HITL) review, emphasizing low-confidence classifications and duplicate rows found in the imported eSOA.
5. Commit only approved transactions through the Wallet REST API.
6. Keep financial data on the user's machine and avoid maintaining a transaction database.

This is both a useful monthly workflow and a portfolio-quality reference for local AI, document processing, evaluation, secure integration, and human-centered automation.

## 2. Confirmed decisions

| Topic                 | Decision                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Initial interface     | Local web application                                                                                           |
| Platform support      | Cross-platform                                                                                                  |
| Statement formats     | PDF, image, and CSV; bank-specific sample fixtures will be supplied                                             |
| Categorization model  | User's available local LLM (Apple Intelligence is one intended option)                                          |
| Learning source       | User-imported Wallet history                                                                                    |
| Persistence           | No transaction database; process data in memory and use encrypted temporary local files only when necessary     |
| Currency              | One currency in v1                                                                                              |
| Review                | Flag low-confidence classifications with useful notes; report duplicates found inside the eSOA                  |
| Wallet integration    | Wallet REST API first; MCP later for reports/custom workflows                                                   |
| First parser          | `bdo-visa-gold-ph-image-v1`, for the supplied BDO Visa Gold PHP image layout                                    |
| BDO transaction date  | Use the sale date; do not use the post date                                                                     |
| BDO exclusions        | Exclude payment-received, previous-balance, subtotal, and total rows                                            |
| Transaction splitting | Extract one record per statement charge; users may split a record during HITL review                            |
| Wallet access         | The project owner has Wallet Premium access and can generate an API token                                       |
| Quality bar           | Polished UX, local-AI design, extraction/classification metrics, tests, CI, and clear contributor documentation |

## 3. Assumptions to validate during implementation

These assumptions prevent private data from lingering while still allowing a reliable import workflow.

1. A session is ephemeral: uploaded statements, imported history, API responses, prompts, and proposed transactions are deleted when the session ends or the user explicitly clears it.
2. The user may choose an encrypted, session-scoped temporary workspace for large PDFs/images; it is securely removed after completion. No automatic long-term cache is created.
3. The Wallet API token is supplied at runtime and stored only in the browser/session process unless the user later explicitly opts into operating-system credential storage.
4. A Wallet API token identifies the user but not the destination account. The user selects a writable destination Wallet account before committing. Multiple destination accounts can be added later without changing the normalized transaction model.
5. "Duplicate" in v1 means an exact or near-exact repeated transaction within the imported eSOA. Cross-checking against transactions already in Wallet is deferred until matching rules and user expectations are defined.

## 4. Architecture

Use a local application with a browser UI and a loopback-only backend. The backend gives the project secure access to local files, OCR engines, local LLM providers, and Wallet REST without exposing credentials to browser JavaScript.

```text
Browser UI (localhost only)
    |
    +-- Import statement/history, configure model, review, approve
    |
Local application service
    |
    +-- Ingestion adapters: CSV | text-PDF | scanned PDF/image + OCR
    +-- Bank parser registry: bank/layout-specific extraction rules
    +-- Normalizer + validator + duplicate detector
    +-- Local LLM provider adapter + retrieval over imported history
    +-- Review/session store (memory; encrypted temporary files only)
    +-- Wallet REST client + import journal
    |
    +-- Local LLM runtime(s) selected by the user
    +-- Wallet REST API
```

### Recommended initial stack

- **Frontend:** React, TypeScript, and a component library with accessible tables/forms.
- **Local backend:** TypeScript/Node.js service, bound to `127.0.0.1` only.
- **Document processing:** CSV parser; native PDF text extraction; OCR only when no usable text layer exists.
- **Local model connection:** provider interface supporting a local OpenAI-compatible endpoint first (for example Ollama or LM Studio). Apple Intelligence support should be a separate adapter when its usable local integration path is confirmed.
- **Validation:** Zod (or equivalent runtime schemas) at every system boundary.
- **Tests:** Vitest/unit tests, fixture-driven parser tests, Playwright end-to-end tests, and mocked Wallet REST contract tests.

The model provider, statement parser, OCR engine, and Wallet client must be interfaces. This keeps bank layouts and local-model runtimes replaceable rather than embedded in page logic.

## 5. Data contracts

### 5.1 Canonical extracted transaction

```ts
type ExtractedTransaction = {
  sourceRowId: string;
  statementId: string;
  date: string; // ISO calendar date
  description: string;
  amount: number; // signed, normalized to the chosen currency
  currency: string;
  balance?: number;
  reference?: string;
  source: {
    format: 'csv' | 'pdf-text' | 'ocr';
    bankParserId: string;
    page?: number;
    row?: number;
    rawText: string;
  };
  extractionConfidence: number;
  issues: Issue[];
};
```

### 5.2 Proposed Wallet transaction

```ts
type ProposedTransaction = ExtractedTransaction & {
  proposalId: string;
  payee?: string;
  walletCategoryId?: string;
  walletCategoryName?: string;
  classificationConfidence: number;
  classificationRationale: string;
  reviewState: 'needs_review' | 'approved' | 'excluded';
  issues: Issue[];
};

type Issue = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  relatedSourceRowIds?: string[];
};
```

Keep the raw source location with every row. A reviewer must be able to see why a transaction was extracted or flagged without the system silently inventing data.

The default relationship is one extracted row to one proposed Wallet transaction. During HITL review, a user may split one proposal into multiple proposals. Every split child retains the same `sourceRowId`, receives its own `proposalId`, and must pass a deterministic sum check against the source amount before approval. Extraction itself never infers or creates a split.

### 5.3 First parser contract: BDO Visa Gold PHP image

The first adapter is `bdo-visa-gold-ph-image-v1` and recognizes the supplied BDO Visa Gold PHP statement layout.

- Use `Sale Date` as the canonical transaction date. Do not use `Post Date` as a transaction field.
- Treat statement purchases and fees as credit-card expenses. The canonical/REST-facing signed amount is negative; reconciliation against positive statement totals uses its absolute value.
- Exclude `PAYMENT RECEIVED - THANK YOU`, `PREVIOUS STATEMENT BALANCE`, `SUBTOTAL`, and `TOTAL` from proposed expenses.
- Append continuation lines such as `INSTALMENT 2 OF 3` to the preceding transaction description. For example, the reviewed description may be `Ikea furnitures | 2 of 3`.
- Attach a `Reference:` continuation line to its preceding transaction as source/reference metadata.
- Identify the supplied statement/session as `BDO_VGOLD_202608`; this identifier is user-provided metadata and is not inferred solely from the statement layout.
- Produce exactly one extracted row per statement charge. Any personal allocation or payee split happens only during HITL review.

### 5.4 Classification output requirements

The LLM must return schema-valid JSON, never an unstructured answer. Its output is limited to categories available from the imported Wallet history/category mapping, plus an explicit `unknown` outcome. It must return:

- selected category or `unknown`;
- confidence from 0 to 1;
- short reviewer-facing rationale;
- references to the most relevant local historical examples.

Model output is advisory. Deterministic validation decides whether it is acceptable; a malformed, unavailable, or low-confidence response routes the record to review.

## 6. Phased delivery plan

### Phase 0 — Repository foundation and safety baseline

**Objective:** Make the repository safe to clone, easy to contribute to, and ready for local-only development.

Deliverables:

- Project scaffold, package manager lockfile, formatting, linting, type checking, test commands, and `.env.example`.
- `.gitignore` rules that exclude statements, imported histories, API tokens, OCR output, session files, screenshots containing financial data, and test artifacts.
- A privacy/security document describing local processing, temporary-file lifetime, telemetry policy (none by default), redaction, and secret handling.
- Synthetic, clearly labeled fixtures only; never commit real financial statements or Wallet exports.
- Architecture decision records (ADRs) for local-first processing, temporary-data policy, local-model provider interface, and REST-first Wallet integration.
- CI for lint, type check, unit tests, dependency/security checks, and secret scanning.

Acceptance criteria:

- A contributor can run the application and test suite from documented commands.
- CI passes from a clean clone with no credential or statement required.
- A repository scan confirms ignored local data cannot be accidentally staged.

### Phase 1 — Statement ingestion and normalized extraction

**Objective:** Reliably turn one supplied bank statement layout into validated canonical rows.

Deliverables:

- Drag-and-drop/file-picker import for CSV, PDF, and image files.
- File validation, format detection, encrypted temporary workspace, and explicit session clear control.
- Extraction routing: CSV parser, PDF text parser, or OCR fallback.
- Bank-parser registry and a first bank/layout adapter based on supplied redacted/synthetic fixtures.
- Normalization for dates, signed amounts, descriptions, reference numbers, and one configured currency.
- BDO v1 normalization according to the parser contract in section 5.3, including sale-date selection, continuation-line attachment, statement-row exclusions, and PHP credit-card expense signs.
- Source traceability: page/row/raw excerpt shown in the review UI.
- Extraction validation rules: missing date/amount, invalid decimal, suspicious balance, and malformed row warnings.

Acceptance criteria:

- The first supported layout's fixture suite reaches a pre-agreed row-level precision/recall target (recommendation: at least 99% for CSV/text PDF; at least 97% for OCR samples).
- Every extracted row has a source location and validation result.
- Unsupported layouts fail clearly with a safe diagnostic and no network upload.

### Phase 2 — Wallet history import and local categorization

**Objective:** Produce auditable category proposals from imported history without sending statement data to a cloud model.

Deliverables:

- Import flow and schema adapter for a Wallet history export/sample.
- Local category catalog and example index built only for the active session.
- Provider-neutral local LLM adapter and setup screen with a connection/privacy test.
- Retrieval strategy that selects relevant local examples deterministically before prompting the model.
- JSON-schema-constrained classification response, confidence calibration, rationale, and safe `unknown` fallback.
- Offline evaluation harness using synthetic labeled transactions, with baseline deterministic matching and model-assisted metrics.

Acceptance criteria:

- A disconnected-network test can categorize using the selected local model runtime.
- No model request leaves the local machine, verified by provider configuration and an integration test with a blocked network.
- Low-confidence, unknown, malformed, and unavailable-model outcomes appear as review-required records.
- Evaluation results are reproducible from versioned synthetic fixtures.

### Phase 3 — Validation, duplicate detection, and HITL review

**Objective:** Make every proposal understandable, editable, and safe to approve.

Deliverables:

- Review table with filters for `needs_review`, warnings/errors, duplicates, and approved/excluded rows.
- Transaction detail drawer showing source excerpt, parser confidence, historical examples, model rationale, and category selector.
- Rule-based duplicate detection within the eSOA, using exact matches and configurable near-match signals (date, amount, normalized description, reference).
- Clear notes naming duplicate candidates; no silent deletion or automatic exclusion.
- Bulk approvals for non-flagged records, individual edits, exclusions, and a final pre-commit summary.
- Re-run categorization only for edited/flagged records, retaining unchanged decisions.
- Review audit trail held in the active session and exportable by the user as a redacted/non-sensitive summary.

Acceptance criteria:

- A reviewer can resolve every blocking issue without re-importing the statement.
- No row can be committed until it is explicitly approved and has a valid category/account mapping.
- Editing one record re-runs only that record's classification, not the complete statement.

### Phase 4 — Wallet REST commit and recovery

**Objective:** Commit the exact approved set safely and give the user an accurate outcome for every row.

Deliverables:

- Runtime API-token entry and connectivity validation; never log the token.
- Account/category selection and a mapper from approved records to Wallet REST payloads.
- Dry-run view that displays the exact count and fields to be sent.
- Batched write client respecting documented endpoint limits, rate-limit headers, retry-after responses, and per-item results.
- Session-only import journal keyed by source row ID and Wallet result ID to prevent accidental re-submission during one session.
- Results screen separating successful, client-error, server-error/retryable, and not-submitted transactions.
- Mocked REST contract tests, including partial success, `207` responses, `429` throttling, sync delay, and retry behavior.

Acceptance criteria:

- The application never reports a batch as wholly successful when Wallet returns mixed results.
- A retry submits only rows that were not successfully created during the active session.
- User sees the final Wallet IDs/errors and can export a local result summary before clearing the session.

### Phase 5 — Product polish, extensibility, and public release

**Objective:** Make the project convincing as an open-source portfolio project and straightforward for others to extend.

Deliverables:

- Guided onboarding for local model setup, Wallet token setup, history import, and first statement import.
- Accessibility pass, responsive layout, empty/error/loading states, and non-sensitive screenshots/GIFs.
- Parser-authoring guide explaining how to add a bank layout with synthetic/redacted fixtures and tests.
- Model-provider guide, threat model, contribution guide, issue/PR templates, code of conduct, and license.
- Release workflow, semantic versioning/changelog, and a sample demo that uses only fake data.
- Performance and accuracy benchmark report with methodology and limitations.
- Optional opt-in diagnostic bundle that redacts data by default; no analytics service in v1.

Acceptance criteria:

- A new contributor can add a parser against a sample fixture following documented steps.
- The demo can be run end-to-end without a real statement, local history, Wallet token, or internet connection (except the optional commit step).
- Public documentation clearly distinguishes production-ready capabilities from experimental adapters.

## 7. Quality gates

| Area           | Required gate                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Privacy        | No real financial data, history exports, API tokens, prompts, or OCR artifacts in Git, logs, telemetry, or crash reports           |
| Extraction     | Fixture-driven row-level accuracy reports by bank/layout and source format                                                         |
| Classification | Precision/coverage/confidence calibration measured against synthetic labeled sets; unknown is preferred over a misleading category |
| Correctness    | Runtime schemas, deterministic normalization, source traceability, and no commit of unapproved rows                                |
| Wallet writes  | Idempotent active-session retry behavior, mixed-result handling, rate-limit backoff, and mock contract tests                       |
| UX             | Keyboard-accessible review table, obvious warning states, explicit irreversible-action confirmation                                |
| Engineering    | Formatter, linter, strict type check, unit/integration/E2E tests, CI, dependency audit, and secret scan                            |

## 8. Deferred scope

Keep the following outside v1 unless a real statement requires them:

- Cloud-hosted LLMs and remote statement processing.
- Persistent local transaction/history database and automatic learning across sessions.
- Multiple currencies, FX conversion, and automatic transfer reconciliation.
- Matching eSOA rows against pre-existing Wallet records.
- Automatic duplicate removal.
- Direct MCP write flows; MCP is reserved for a later reporting/custom-agent feature.
- Support for every bank before a fixture-backed parser is available.
- Background scheduling or unattended commits.

## 9. Recommended first implementation slice

Build a complete vertical slice before expanding formats or model providers:

1. Scaffold the local web app and privacy baseline.
2. Support the synthetic BDO Visa Gold PHP image fixture with the first OCR-backed parser.
3. Import a synthetic Wallet-history fixture.
4. Implement deterministic categorization first, with a fake/local-provider adapter returning schema-valid results.
5. Build the review table, duplicate warnings, approvals, and exclusions.
6. Add Wallet REST dry-run plus mocked commit results; enable real writes only after the review/recovery path is tested.
7. Add text-PDF and CSV parsers, each backed by new synthetic fixtures and accuracy measurements.

This sequence proves the full user journey early while keeping sensitive integrations and unreliable OCR from blocking the core product.

## 10. Inputs needed before starting Phase 1

1. One safely synthetic eSOA sample per initial bank/layout, plus both the expected one-row-per-charge extraction output and, when different, the expected post-HITL Wallet output.
2. A redacted/synthetic Wallet history export that identifies its file format and category fields.
3. The Wallet REST OpenAPI endpoint/payload details for record creation and account/category retrieval, plus confirmation of API-token/Premium access.
4. A decision on the first supported local runtime (recommendation: an OpenAI-compatible local endpoint, because it is portable across operating systems).
5. A name for the first bank parser and the desired first-release transaction fields (minimum: date, description, signed amount, category, destination account, note/reference).

## 11. Supplied inputs and fixture status

1. The initial layout is the three-page, project-owner-confirmed synthetic BDO Visa Gold PHP image fixture under `fixtures/synthetic/bdo/`. It is explicitly allowlisted after provenance review.
2. `fixtures/synthetic/bdo/wallet_records_synthetic.csv` is the expected post-HITL Wallet output and synthetic categorization-history sample. It has 35 Wallet rows totaling PHP 34,957.17. Two source charges are intentionally split because multiple payees are involved. It is not the Phase 1 one-row-per-charge extraction oracle.
3. `fixtures/synthetic/bdo/expected_extraction.csv` is the Phase 1 oracle. It has 33 included statement charges totaling PHP 34,957.17 and four explicitly excluded statement rows. Automated tests reconcile it with the post-HITL fixture.
4. Wallet REST details come from <https://rest.budgetbakers.com/wallet/reference>. The project owner has Wallet Premium and can generate an API token. Users must select a writable destination account returned by the API.
5. Apple Intelligence on the project owner's Apple-silicon Mac is the intended first local model. The provider interface remains portable so other operating systems can use another local runtime. The exact Apple adapter/bridge is finalized before Phase 2 and does not block Phase 1 extraction.
