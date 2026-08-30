import { useState } from 'react';

type Step = {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'doing' | 'done' | 'blocked';
  actionLabel?: string;
};

export type OnboardingState = {
  hasExtraction: boolean;
  hasHistory: boolean;
  providerConfigured: boolean;
  providerReachable: boolean | null;
  hasProposals: boolean;
  hasReview: boolean;
  approvedCount: number;
  needsReviewCount: number;
  isDemo: boolean;
  extractionError?: string;
  historyError?: string;
  providerError?: string;
};

export function OnboardingPanel({
  state,
  onLoadDemo,
  onImportStatement,
  onImportHistory,
  onConfigureProvider,
  onCategorize,
  onReview,
  onWalletSetup,
  demoPending,
}: {
  state: OnboardingState;
  onLoadDemo: () => void;
  onImportStatement: () => void;
  onImportHistory: () => void;
  onConfigureProvider: () => void;
  onCategorize: () => void;
  onReview: () => void;
  onWalletSetup: () => void;
  demoPending: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);

  // Dismissed guide reappears after refresh or session clear — no browser storage.
  if (dismissed) {
    return (
      <div style={{ marginBottom: '1rem', textAlign: 'right' }}>
        <button
          type="button"
          onClick={() => setDismissed(false)}
          aria-label="Show onboarding guide"
          style={{
            padding: '0.4rem 0.8rem',
            borderRadius: 6,
            border: '1px solid #c3cec5',
            background: 'white',
            fontSize: '0.85rem',
          }}
        >
          Show guide
        </button>
      </div>
    );
  }

  const steps: Step[] = [
    {
      id: '1',
      title: '1 — Local processing & formats',
      description:
        'All files are processed locally at 127.0.0.1 and cleared when you clear the session. Supported: CSV, PDF, JPG/PNG/WebP/TIFF/BMP. Only the BDO Visa Gold PHP image layout is parser-backed; other formats return a safe unsupported-layout error.',
      status: 'done',
    },
    {
      id: '2',
      title: '2 — Import statement or load synthetic demo',
      description:
        'Import your statement via the picker or try the credential-free offline synthetic demo (uses only committed versioned synthetic fixtures and normal parsing/history/categorization/review paths; cannot contact Wallet).',
      status: state.hasExtraction ? 'done' : 'doing',
      actionLabel: state.hasExtraction ? undefined : 'Demo or import',
    },
    {
      id: '3',
      title: '3 — Import Wallet history',
      description:
        'Import a Wallet-native export or the 15-category synthetic history CSV. History is session-scoped and in memory only.',
      status: !state.hasExtraction
        ? 'blocked'
        : state.hasHistory
          ? 'done'
          : 'doing',
    },
    {
      id: '4',
      title: '4 — Configure / test loopback model',
      description:
        'Configure a loopback OpenAI-compatible endpoint (e.g., Ollama at 127.0.0.1:11434) and run Test local connection. No statement data is sent during the test. Manual review remains possible even if the model is unavailable — low-confidence/unknown proposals stay in needs_review.',
      status: !state.hasHistory
        ? 'blocked'
        : state.providerConfigured
          ? 'done'
          : 'doing',
    },
    {
      id: '5',
      title: '5 — Review and approve',
      description:
        'Review proposals, edit categories (allowlisted only), handle duplicates (candidates, not facts), split centavo-exact totals, and approve explicitly. No row becomes approved without your action.',
      status: !state.hasProposals
        ? 'blocked'
        : state.approvedCount > 0
          ? 'done'
          : 'doing',
    },
    {
      id: '6',
      title: '6 — Optional Wallet commit (explicit, external)',
      description:
        'Only after approval, you may provide a runtime Wallet token (server-session only, never returned/logged), select a writable account, map categories, create an immutable dry-run (Not sent yet), and explicitly confirm the commit. This sends data externally to https://rest.budgetbakers.com/wallet. In synthetic demo this step is unavailable by design.',
      status:
        !state.hasReview || state.needsReviewCount > 0
          ? 'blocked'
          : state.isDemo
            ? 'blocked'
            : 'doing',
    },
  ];

  const nextStep = steps.find((s) => s.status === 'doing');

  return (
    <section
      aria-labelledby="onboarding-title"
      style={{
        background: '#fcfdf9',
        border: '1px solid #285c42',
        borderRadius: '1rem',
        padding: '1rem',
        marginBottom: '1.5rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
        }}
      >
        <h2
          id="onboarding-title"
          style={{
            margin: 0,
            fontSize: '1rem',
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          Getting started — onboarding (state-derived, not persisted)
        </h2>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss onboarding guide"
          style={{
            padding: '0.3rem 0.6rem',
            borderRadius: 6,
            border: '1px solid #c3cec5',
            background: 'white',
            fontSize: '0.8rem',
          }}
        >
          Dismiss
        </button>
      </div>

      <p style={{ fontSize: '0.9rem', color: '#46534b', margin: '0 0 1rem' }}>
        Local lifetime: session data lives only in memory (or encrypted
        temporary workspace) and is deleted on <strong>Clear session</strong>,
        graceful shutdown, or stale cleanup. Refreshing the browser does not
        restore history or proposals. Wallet is the only optional external
        origin and is only contacted after your explicit confirmation.
      </p>

      {nextStep && (
        <p
          aria-live="polite"
          style={{
            background: '#eef2eb',
            borderRadius: 8,
            padding: '0.6rem 0.8rem',
            fontSize: '0.9rem',
            margin: '0 0 1rem',
          }}
        >
          <strong>Next step:</strong> {nextStep.title} —{' '}
          {nextStep.description.slice(0, 120)}…
        </p>
      )}

      <ol
        style={{
          display: 'grid',
          gap: '0.6rem',
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}
      >
        {steps.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'flex-start',
              padding: '0.6rem',
              borderRadius: 8,
              background:
                s.status === 'doing'
                  ? '#eef2eb'
                  : s.status === 'done'
                    ? '#f0faf0'
                    : s.status === 'blocked'
                      ? '#fefefe'
                      : 'white',
              border:
                s.status === 'doing'
                  ? '1px solid #285c42'
                  : '1px solid #e4e9e3',
              opacity: s.status === 'blocked' ? 0.7 : 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 28,
                height: 28,
                borderRadius: '50%',
                background:
                  s.status === 'done'
                    ? '#285c42'
                    : s.status === 'doing'
                      ? '#2f8c5a'
                      : '#e4e9e3',
                color:
                  s.status === 'done' || s.status === 'doing'
                    ? 'white'
                    : '#46534b',
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              {s.status === 'done' ? '✓' : s.id.replace(' —', '')}
            </span>
            <div style={{ flex: 1 }}>
              <strong
                style={{
                  fontSize: '0.9rem',
                  color: s.status === 'blocked' ? '#69736c' : '#17211b',
                }}
              >
                {s.title}
              </strong>
              <p
                style={{
                  margin: '0.25rem 0 0',
                  fontSize: '0.85rem',
                  color: '#46534b',
                  lineHeight: 1.5,
                }}
              >
                {s.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginTop: '1rem',
        }}
      >
        <button
          type="button"
          onClick={onLoadDemo}
          disabled={demoPending}
          aria-label="Load synthetic demo (offline, no Wallet)"
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #285c42',
            background: state.isDemo ? '#eef2eb' : '#285c42',
            color: state.isDemo ? '#285c42' : 'white',
            fontWeight: 600,
            opacity: demoPending ? 0.6 : 1,
          }}
        >
          {demoPending
            ? 'Loading demo…'
            : state.isDemo
              ? 'Demo loaded — synthetic'
              : 'Load synthetic demo'}
        </button>
        <button
          type="button"
          onClick={onImportStatement}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #c3cec5',
            background: 'white',
            fontWeight: 600,
          }}
        >
          Go to import
        </button>
        <button
          type="button"
          onClick={onImportHistory}
          disabled={!state.hasExtraction}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #c3cec5',
            background: 'white',
            fontWeight: 600,
            opacity: !state.hasExtraction ? 0.5 : 1,
          }}
        >
          Go to history import
        </button>
        <button
          type="button"
          onClick={onConfigureProvider}
          disabled={!state.hasHistory}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #c3cec5',
            background: 'white',
            fontWeight: 600,
            opacity: !state.hasHistory ? 0.5 : 1,
          }}
        >
          Go to model setup
        </button>
        <button
          type="button"
          onClick={onCategorize}
          disabled={!state.hasHistory || state.hasProposals}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #c3cec5',
            background: 'white',
            fontWeight: 600,
            opacity: !state.hasHistory || state.hasProposals ? 0.5 : 1,
          }}
        >
          Run categorization
        </button>
        <button
          type="button"
          onClick={onReview}
          disabled={!state.hasProposals}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #c3cec5',
            background: 'white',
            fontWeight: 600,
            opacity: !state.hasProposals ? 0.5 : 1,
          }}
        >
          Go to review
        </button>
        <button
          type="button"
          onClick={onWalletSetup}
          disabled={
            !state.hasReview || state.needsReviewCount > 0 || state.isDemo
          }
          title={state.isDemo ? 'Wallet is disabled in demo' : undefined}
          style={{
            padding: '0.6rem 1rem',
            borderRadius: 8,
            border: '1px solid #c3cec5',
            background: 'white',
            fontWeight: 600,
            opacity:
              !state.hasReview || state.needsReviewCount > 0 || state.isDemo
                ? 0.5
                : 1,
          }}
        >
          Go to Wallet setup
        </button>
      </div>

      {state.isDemo && (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: '1rem 0 0',
            padding: '0.6rem 0.8rem',
            background: '#fff8e6',
            border: '1px solid #f0d9a0',
            borderRadius: 8,
            fontSize: '0.85rem',
          }}
        >
          <strong>Synthetic demo data — not a financial record.</strong> Wallet
          commit is unavailable in this mode by design — no token is accepted
          and no Wallet request is sent. Clear the demo to start a live session.
        </p>
      )}
    </section>
  );
}
