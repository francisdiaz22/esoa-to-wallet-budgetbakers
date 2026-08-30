export type ClassificationInput = {
  sourceRowId: string;
  description: string;
  amountMinor: number;
  date: string;
  payee?: string;
  categories: string[]; // allowlist bounded
  examples: import('./contracts.js').RetrievedExample[];
  schemaVersion: string;
};

export type ProviderSuccess = {
  ok: true;
  categoryName: string; // allowed or 'unknown'
  confidence: number; // [0,1]
  rationale: string; // 1..500
  exampleIds: string[]; // references to retrieved examples
};

export type ProviderFailure = {
  ok: false;
  code: 'unavailable' | 'malformed';
  message: string;
};

export type ProviderClassificationResult = ProviderSuccess | ProviderFailure;

export type ProviderTestResult = {
  ok: boolean;
  modelLabel?: string;
  message?: string;
};

export interface LocalModelProvider {
  readonly baseUrl: string;
  readonly model?: string;
  testConnection(signal?: AbortSignal): Promise<ProviderTestResult>;
  classify(
    input: ClassificationInput,
    signal?: AbortSignal,
  ): Promise<ProviderClassificationResult>;
}
