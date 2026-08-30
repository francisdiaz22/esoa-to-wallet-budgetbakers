# Parser authoring guide

> All fixtures, screenshots, and examples must be synthetic. Redacted real statements are prohibited.

This guide explains how to add a bank/layout parser with fixture-driven development without private data.

## Registry contract

- Implement `BankParser` interface in `src/server/ingestion/parserRegistry.ts` style:
  `readonly id: string` (e.g., `bdo-visa-gold-ph-image-v1`), `canParse(document)` returns scored `ParserMatch`, `parse(document, context)` throws on missing statement context.
- Register only via `ParserRegistry([bdoParser, myParser])`. Registry selects exactly one confident match; ties or below-threshold matches return `unsupported_layout`.
- Detection must use stable layout anchors (header labels, column structure, expected transaction row pattern), never account/card numbers, statement dates, merchant names, or fixture filenames.
- `ParserContext` provides `statementId` (user-provided metadata like `BDO_VGOLD_20260729`), `statementYear` (parsed from OCR-visible statement date, never `new Date().getFullYear()`), and `currency` (`PHP` only).

## Recognition → normalization → exclusion → continuations

1. **Recognition:** Scan `ExtractedDocument` (`DocumentPage`/`TextLine` with page/order/text/confidence) in reading order. Detect header anchors then transaction row candidates (sale date + description + amount).
2. **Normalization:** Pure functions only:
   - `parseBdoSaleDate` / your `parseSaleDate` → ISO `YYYY-MM-DD` via statement year, reject impossible/ambiguous dates.
   - `parsePhpAmount` → deterministic `parsePhpAmountToMinorUnits` (integer centavos), validate two fraction digits, reject accounting notation until explicitly supported.
   - `normalizeDescription` → whitespace collapse only, preserve meaning plus installment suffix.
   - `normalizeReference` → strip `Reference:` label, reject empty.
   - `toExpenseAmount` → negative minor-unit-safe amount (credit-card expenses).
3. **Exclusions:** Classify rows case/spacing-insensitively into allowed reasons only (`previous-balance`, `credit-card-payment`, `summary`, `other`). Excluded rows remain in `excludedRows` with source ID/page/excerpt/reason; they are not proposed.
4. **Continuations:** Attach `INSTALMENT n OF m` and `Reference:` lines to the immediately preceding eligible transaction. Orphaned continuations produce `malformed_row` warnings, never attach elsewhere. Do not produce a transaction for either line.

## Traceability, integer money/date rules

- Every `ExtractedTransaction` must carry `sourceRowId` deterministic by source order (`p1-r001`…`p3-r033` for BDO fixture; for general BDO use `page + sourceOrder`), `date`, `description`, signed `amount`, `currency: 'PHP'`, `source: {format, bankParserId, page, row, rawText}` with enough original line(s) to justify the normalized result, `extractionConfidence` finite `[0,1]`, and `issues`.
- Never fabricate dates/amounts/references to satisfy an oracle.
- Store/convert/split money as integer `amountMinor` (centavos) via `parsePhpAmountToMinorUnits`; never use float intermediate. `0.10 + 0.20` must preserve centavos.

## Synthetic fixture provenance / allowlist

- Place new synthetic fixtures under `fixtures/synthetic/<bank>/` (e.g., `fixtures/synthetic/mybank/`).
- Must be genuinely synthetic: fake card/account numbers, payees, references, dates, amounts; strip unnecessary metadata/barcodes; label clearly in README.
- After reviewer confirms provenance, add explicit `.gitignore` allowlist entries (`!fixtures/synthetic/mybank/...`) — never broaden ignores to make a fixture pass. Verify with `npm run scan:repository`.
- Provide two oracles: `expected_extraction.csv` (one-row-per-charge, e.g., 33 included + 4 excluded for BDO) and, if review splits apply, a separate post-HITL `wallet_records_*.csv` (e.g., 35 rows). Do not alter the extraction oracle merely to manufacture duplicates.

## Oracle construction, precision/recall, tests

- Include header `statement_id,source_row_id,page,source_order,include,sale_date,description,raw_amount,expected_signed_amount,currency,reference,exclusion_reason`.
- Reference reconciliation: proposed absolute total must reconcile (e.g., BDO PHP 34,957.17) and every proposed amount must be negative PHP.
- Row-level score: `correct included rows / expected included rows` for precision and recall, with a row correct only when all required fields match (ID, page, sale date, description, amounts, reference, excerpt presence). For BDO the gate is 33/33 (100%); general floor remains ≥97% for OCR fixtures.
- Tests required:
  - Contract/unit: normalizers happy/boundary, `sourceRowId` determinism, confidence finite.
  - Parser/unit: new row, multi-page order, installment/reference continuations, orphan cases, each exclusion case, sign, malformed date/amount, ambiguous OCR, missing evidence, below-threshold/ambiguous registry match (see `src/server/ingestion/bdoParser.test.ts`).
  - Fixture/integration: full synthetic import through `POST /api/session/import` via `statementPages` order, assert exact row-by-row agreement.
  - Route/integration: multipart success, MIME/signature mismatch, zero/oversize/multiple, malformed CSV, encrypted PDF, unsupported readable layout (`422`), no-session/cleared GET, repeated DELETE.

## Safe rejection of unsupported layouts

- If no parser confidently matches the `ExtractedDocument`, return `422 unsupported_layout` with stable `code`, safe `message`, `stage`, and `requestId` — never show raw document contents, stacks, paths, prompts, or raw provider responses. Do not retry silently or upload bytes.

## Prohibited

- Redacted real statements (merchant/date/amount/pattern/metadata can still identify a person).
- Hard-coding the fixture filename or the 33 merchant strings as parsing logic.
- Inferring `statementId` from layout alone; it is user-provided session metadata.
- Persisting raw excerpts in `Error.message`, console, logs, or snapshots.

See also: `IMPLEMENTATION.md`, `IMPLEMENT_phase1.md`, `src/server/ingestion/bdoParser.ts`, `fixtures/synthetic/bdo/expected_extraction.csv`.
