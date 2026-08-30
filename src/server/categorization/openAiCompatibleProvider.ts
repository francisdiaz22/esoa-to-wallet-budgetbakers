import { isIP } from 'node:net';
import { LIMITS } from '../ingestion/limits.js';
import type {
  LocalModelProvider,
  ClassificationInput,
  ProviderClassificationResult,
  ProviderTestResult,
} from './provider.js';
import { normalizeCategory, normalizedCategoryKey } from './catalog.js';

function normalizeHostname(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function isLoopbackIp(ip: string): boolean {
  const normalizedHost = normalizeHostname(ip);
  const version = isIP(normalizedHost);
  if (version === 4) {
    return normalizedHost.startsWith('127.');
  }
  if (version === 6) {
    // ::1 is loopback, also 0:0:0:0:0:0:0:1 variants
    const normalized = normalizedHost.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '0:0:0:0:0:0:0:1' ||
      normalized === '::ffff:127.0.0.1'
    );
  }
  return false;
}

export async function validateLoopbackUrl(
  input: string,
): Promise<
  { ok: true; url: URL } | { ok: false; code: string; message: string }
> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Invalid provider URL.',
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must be http(s).',
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must not contain credentials.',
    };
  }
  if (url.hash) {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must not contain fragment.',
    };
  }
  const hostnameRaw = url.hostname;
  if (!hostnameRaw) {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL missing host.',
    };
  }
  const hostname = normalizeHostname(hostnameRaw).toLowerCase();
  if (hostname === 'localhost') {
    // Pin localhost to a literal address so validation and connection cannot be
    // separated by DNS/hosts-file rebinding.
    url.hostname = '127.0.0.1';
    return { ok: true, url };
  }
  if (!isLoopbackIp(hostname)) {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must use localhost or a loopback IP literal.',
    };
  }
  return { ok: true, url };
}

export function validateLoopbackUrlSync(
  input: string,
): { ok: true; url: URL } | { ok: false; code: string; message: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Invalid provider URL.',
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must be http(s).',
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must not contain credentials.',
    };
  }
  if (url.hash) {
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL must not contain fragment.',
    };
  }
  const hostnameRaw = url.hostname;
  if (!hostnameRaw)
    return {
      ok: false,
      code: 'provider_malformed',
      message: 'Provider URL missing host.',
    };
  const hostname = normalizeHostname(hostnameRaw).toLowerCase();
  if (hostname === 'localhost') {
    url.hostname = '127.0.0.1';
    return { ok: true, url };
  }
  if (isLoopbackIp(hostname)) return { ok: true, url };
  return {
    ok: false,
    code: 'provider_malformed',
    message: 'Provider URL must use localhost or a loopback IP literal.',
  };
}

export class OpenAiCompatibleProvider implements LocalModelProvider {
  readonly baseUrl: string;
  readonly model?: string;
  private validatedUrl: URL;

  constructor(baseUrl: string, model?: string) {
    const sync = validateLoopbackUrlSync(baseUrl);
    if (!sync.ok) throw new Error(sync.message);
    this.validatedUrl = sync.url;
    // Normalize baseUrl without trailing slash
    this.baseUrl = this.validatedUrl.toString().replace(/\/$/, '');
    this.model = model;
  }

  async ensureLoopbackResolved(): Promise<
    { ok: true } | { ok: false; code: string; message: string }
  > {
    return (await validateLoopbackUrl(this.baseUrl)) as
      { ok: true } | { ok: false; code: string; message: string };
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderTestResult> {
    const res = await this.ensureLoopbackResolved();
    if (!res.ok) return { ok: false, message: res.message };

    const url = `${this.baseUrl}/v1/models`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      LIMITS.PROVIDER_TIMEOUT_MS,
    );
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      const resp = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: combinedSignal,
      });
      if (resp.status >= 300 && resp.status < 400) {
        return { ok: false, message: 'Provider redirected.' };
      }
      if (!resp.ok) {
        return { ok: false, message: `Provider returned ${resp.status}` };
      }
      const text = await resp.text();
      if (text.length > LIMITS.MAX_PROVIDER_RESPONSE_BYTES) {
        return { ok: false, message: 'Provider response too large.' };
      }
      let json: { data?: { id: string }[] };
      try {
        json = JSON.parse(text);
      } catch {
        // Some providers return empty or non-JSON; treat as reachable if status ok
        return { ok: true, modelLabel: this.model ?? 'unknown' };
      }
      const label = json.data?.[0]?.id ?? this.model ?? 'unknown';
      return { ok: true, modelLabel: label };
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === 'AbortError')
        return { ok: false, message: 'Provider timeout.' };
      return { ok: false, message: 'Provider unavailable.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  async classify(
    input: ClassificationInput,
    signal?: AbortSignal,
  ): Promise<ProviderClassificationResult> {
    const res = await this.ensureLoopbackResolved();
    if (!res.ok)
      return { ok: false, code: 'unavailable', message: res.message };

    // Opaque history IDs are difficult for local models to reproduce exactly.
    // Give the provider short, request-local aliases and translate them back
    // after parsing so the rest of the pipeline retains canonical IDs.
    const exampleIdByAlias = new Map<string, string>();
    const aliasedExamples = input.examples
      .slice(0, LIMITS.MAX_RETRIEVED_EXAMPLES)
      .map((example, index) => {
        const alias = `e${index + 1}`;
        exampleIdByAlias.set(alias, example.historyRecordId);
        return {
          id: alias,
          categoryName: example.categoryName,
          description: example.description.slice(0, 500),
          payee: example.payee?.slice(0, 200),
        };
      });

    // Build sanitized request body - bounded data only
    const bodyObj = {
      model: this.model ?? 'local-model',
      messages: [
        {
          role: 'system',
          content:
            'You are a category classifier. Return JSON with fields: categoryName (string), confidence (0-1), rationale (short string), exampleIds (array containing only the short example IDs supplied in this request, such as "e1"). Only use categories from allowlist plus "unknown".',
        },
        {
          role: 'user',
          content: JSON.stringify({
            transaction: {
              description: input.description.slice(0, 500),
              amountMinor: input.amountMinor,
              date: input.date,
              payee: input.payee?.slice(0, 200),
            },
            categories: input.categories.slice(0, 100),
            examples: aliasedExamples,
            schemaVersion: input.schemaVersion,
          }),
        },
      ],
      temperature: 0,
      max_tokens: 500,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'transaction_category',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              categoryName: {
                type: 'string',
                enum: [...input.categories, 'unknown'],
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              rationale: { type: 'string' },
              exampleIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['categoryName', 'confidence', 'rationale', 'exampleIds'],
            additionalProperties: false,
          },
        },
      },
    };
    const bodyStr = JSON.stringify(bodyObj);
    if (bodyStr.length > LIMITS.MAX_PROVIDER_REQUEST_BYTES) {
      return { ok: false, code: 'malformed', message: 'Request too large.' };
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      LIMITS.PROVIDER_INFERENCE_TIMEOUT_MS,
    );
    const combinedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    const requestOnce = async (
      requestBody: typeof bodyObj,
    ): Promise<ProviderClassificationResult> => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        redirect: 'manual',
        signal: combinedSignal,
      });
      if (resp.status >= 300 && resp.status < 400) {
        return {
          ok: false,
          code: 'unavailable',
          message: 'Provider redirected.',
        };
      }
      if (!resp.ok) {
        return {
          ok: false,
          code: 'unavailable',
          message: `Provider returned ${resp.status}`,
        };
      }
      const text = await resp.text();
      if (text.length > LIMITS.MAX_PROVIDER_RESPONSE_BYTES) {
        return {
          ok: false,
          code: 'malformed',
          message: 'Provider response too large.',
        };
      }
      let outer: { choices?: { message?: { content?: string } }[] };
      try {
        outer = JSON.parse(text);
      } catch {
        return {
          ok: false,
          code: 'malformed',
          message: 'Provider returned non-JSON.',
        };
      }
      const content = outer.choices?.[0]?.message?.content;
      if (!content) {
        return {
          ok: false,
          code: 'malformed',
          message: 'Missing provider content.',
        };
      }
      let candidate: {
        categoryName?: unknown;
        confidence?: unknown;
        rationale?: unknown;
        exampleIds?: unknown;
      };
      try {
        candidate = JSON.parse(content);
      } catch {
        return {
          ok: false,
          code: 'malformed',
          message: 'Provider content not JSON.',
        };
      }
      // Validate fields
      if (
        typeof candidate.categoryName !== 'string' ||
        candidate.categoryName.length === 0 ||
        candidate.categoryName.length > 200
      ) {
        return {
          ok: false,
          code: 'malformed',
          message: 'Invalid categoryName.',
        };
      }
      if (
        typeof candidate.confidence !== 'number' ||
        !Number.isFinite(candidate.confidence) ||
        candidate.confidence < 0 ||
        candidate.confidence > 1
      ) {
        return { ok: false, code: 'malformed', message: 'Invalid confidence.' };
      }
      if (
        typeof candidate.rationale !== 'string' ||
        candidate.rationale.length === 0 ||
        candidate.rationale.length > 500
      ) {
        return { ok: false, code: 'malformed', message: 'Invalid rationale.' };
      }
      if (!Array.isArray(candidate.exampleIds)) {
        return { ok: false, code: 'malformed', message: 'Invalid exampleIds.' };
      }
      for (const id of candidate.exampleIds) {
        if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
          return {
            ok: false,
            code: 'malformed',
            message: 'Invalid exampleId.',
          };
        }
      }
      if (candidate.exampleIds.length > LIMITS.MAX_RETRIEVED_EXAMPLES) {
        return {
          ok: false,
          code: 'malformed',
          message: 'Too many exampleIds.',
        };
      }
      const canonicalCategories = new Map(
        input.categories.map((category) => [
          normalizedCategoryKey(category),
          category,
        ]),
      );
      const normalizedCandidate = normalizeCategory(candidate.categoryName);
      const canonicalCategory =
        normalizedCategoryKey(normalizedCandidate) === 'unknown'
          ? 'unknown'
          : canonicalCategories.get(normalizedCategoryKey(normalizedCandidate));
      if (!canonicalCategory) {
        return {
          ok: false,
          code: 'malformed',
          message: `Category ${JSON.stringify(normalizedCandidate)} is not in the catalog.`,
        };
      }

      return {
        ok: true,
        categoryName: canonicalCategory,
        confidence: candidate.confidence,
        rationale: candidate.rationale,
        exampleIds: (candidate.exampleIds as string[]).map(
          (id) => exampleIdByAlias.get(id) ?? id,
        ),
      };
    };

    try {
      const firstResult = await requestOnce(bodyObj);
      if (firstResult.ok || firstResult.code !== 'malformed') {
        return firstResult;
      }

      // Some local OpenAI-compatible servers accept response_format but do not
      // enforce it. Give them one bounded correction attempt, within the same
      // overall timeout, without echoing their malformed response back.
      const repairBody = {
        ...bodyObj,
        messages: [
          ...bodyObj.messages,
          {
            role: 'system',
            content:
              'Your previous response violated the required schema. Try once more. Output only the JSON object, with an exact categoryName from the supplied categories or "unknown", confidence from 0 to 1, a short non-empty rationale, and exampleIds containing only supplied example aliases.',
          },
        ],
      };
      if (
        JSON.stringify(repairBody).length > LIMITS.MAX_PROVIDER_REQUEST_BYTES
      ) {
        return firstResult;
      }
      const repairedResult = await requestOnce(repairBody);
      if (!repairedResult.ok && repairedResult.code === 'malformed') {
        return {
          ...repairedResult,
          message: `Malformed after one repair attempt: ${repairedResult.message}`,
        };
      }
      return repairedResult;
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === 'AbortError')
        return { ok: false, code: 'unavailable', message: 'Provider timeout.' };
      return {
        ok: false,
        code: 'unavailable',
        message: 'Provider unavailable.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const providerMeta = {
  adapter: 'openai-compatible-loopback',
  version: '1.0.0',
};
