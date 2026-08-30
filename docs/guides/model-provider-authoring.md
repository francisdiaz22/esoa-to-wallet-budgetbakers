# Model provider authoring guide

> No direct review/Wallet authority. Provider output is advisory; deterministic validation decides the final outcome.

## Provider interface

Implement `LocalModelProvider` from `src/server/categorization/provider.ts`:

```ts
interface LocalModelProvider {
  readonly baseUrl: string; // loopback only
  readonly model?: string;
  testConnection(signal?): Promise<ProviderTestResult>;
  classify(
    input: ClassificationInput,
    signal?,
  ): Promise<ProviderClassificationResult>;
}
type ClassificationInput = {
  sourceRowId: string;
  description: string;
  amountMinor: number;
  date: string;
  payee?: string;
  categories: string[]; // bounded allowlist (from active-session catalog + unknown)
  examples: RetrievedExample[]; // bounded (≤5)
  schemaVersion: string;
};
type ProviderClassificationResult =
  | {
      ok: true;
      categoryName: string;
      confidence: number;
      rationale: string;
      exampleIds: string[];
    }
  | { ok: false; code: 'unavailable' | 'malformed'; message: string };
```

- Accept sanitized classification input only: transaction projection (`description` ≤500, `amountMinor`, `date`, `payee` ≤200), bounded category allowlist, bounded retrieved examples, and `schemaVersion`. Do not expose a generic arbitrary-prompt endpoint to the browser.
- Return schema-valid structured response only: allowed category or `unknown`, finite confidence `[0,1]`, short rationale `1..500`, and `exampleIds` subset of retrieved IDs. Allowlists and references are validated; nothing is clamped or repaired.
- Use `provider.testConnection()` for health/model-list without sending statement/history content. It reports `reachable: true/false` and a non-sensitive model label.

## Loopback enforcement

- `baseUrl` is configured per active session (`POST /api/session/:id/provider`) and stored only in private server state (never returned beyond safe display, never persisted if contains credentials).
- Parse and validate server-side before use: reject `baseUrl` that is not `http(s)`, contains credentials/fragment, is not loopback (`127.0.0.1`, `::1`, or `localhost` resolved and rechecked as loopback). For `localhost`, resolve every address and re-check each as loopback (DNS rebinding mitigation). Reject private/link-local/non-loopback, remote, credentialed, or redirected destinations. Do not accept headers/tokens/proxy settings.
- Disable redirects (`redirect: 'manual'`) and apply bounded connect/read timeouts (5s `PROVIDER_TIMEOUT_MS`), request ≤64 KiB, response ≤64 KiB, plus cancellation when session is cleared. Do not download language data during statement processing.

## Bounded request projection

All provider requests must demonstrate bounded data only. The server is the only process that contacts the provider; browser JavaScript never receives prompts/credentials/raw replies. Captured requests in tests must contain only `description`/`amountMinor`/`date`/`payee`/`categories`/`examples`/`schemaVersion`.

## Schema validation, timeout / cancellation / failure, unknown / low-confidence behavior

- Validate every provider reply with Zod; reject hallucinated categories or example IDs, malformed JSON, duplicate/missing rows, stale history versions, out-of-range confidence without converting into a valid proposal.
- Timeouts/refusals/oversized responses/non-JSON → typed `unavailable` or `malformed`; cancellation on session clear must discard the result.
- Apply documented confidence threshold (`0.6`): `unknown`, low-confidence, `provider_unavailable`, or `provider_malformed` → `reviewState: 'needs_review'` with precise safe issue code; never auto-approved. `unknown` is useful evidence but never approvable.
- Baseline fallback: exact normalized description with single eligible category or retrieval `score ≥0.9` with `margin ≥0.2` proposes with baseline `0.95`; otherwise `unknown` (`0.3–0.4`). Baseline uses same `CategoryProposal` schema and is included in evaluation metrics.

## Test fake

- Inject a deterministic fake loopback provider for unit/integration/e2e. Example: `POST /v1/models` returns model list; `POST /v1/chat/completions` returns bounded JSON with category/confidence/rationale/exampleIds based on input `description`. Never require a real model or cloud service in CI.
- Example fake: `src/server/categorization/openAiCompatibleProvider.ts` + `e2e/phase2.spec.ts` fake server.

## No direct review/Wallet authority

- Provider has no authority to approve, exclude, split, or decide retryability; those belong to `ReviewService` and `WalletCommitService`. Replacing history invalidates all review state.

See also: `ADR 0003`, `src/server/categorization/`, `fixtures/synthetic/evaluation/cases.json`, `IMPLEMENT_phase2.md`.
