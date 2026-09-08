type StepStatus = 'active' | 'complete' | 'locked' | 'optional';

type Step = {
  id: number;
  title: string;
  shortTitle: string;
  status: StepStatus;
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

type GuideAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  secondary?: boolean;
  ariaLabel?: string;
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
  const reviewComplete =
    state.hasReview && state.needsReviewCount === 0 && state.approvedCount > 0;

  const steps: Step[] = [
    {
      id: 1,
      title: 'Import a statement',
      shortTitle: 'Statement',
      status: state.hasExtraction ? 'complete' : 'active',
    },
    {
      id: 2,
      title: 'Add Wallet history',
      shortTitle: 'History',
      status: !state.hasExtraction
        ? 'locked'
        : state.hasHistory
          ? 'complete'
          : 'active',
    },
    {
      id: 3,
      title: 'Match categories',
      shortTitle: 'Categorize',
      status: !state.hasHistory
        ? 'locked'
        : state.hasProposals
          ? 'complete'
          : 'active',
    },
    {
      id: 4,
      title: 'Review and approve',
      shortTitle: 'Review',
      status: !state.hasProposals
        ? 'locked'
        : reviewComplete
          ? 'complete'
          : 'active',
    },
    {
      id: 5,
      title: 'Send to Wallet',
      shortTitle: 'Send',
      status: reviewComplete && !state.isDemo ? 'active' : 'optional',
    },
  ];

  let eyebrow = 'Start here';
  let title = 'Choose how you want to begin';
  let description =
    'Import your own statement, or explore a safe sample first. You will review every transaction before anything can be sent to Wallet.';
  let actions: GuideAction[] = [
    {
      label: 'Choose statement files',
      onClick: onImportStatement,
    },
    {
      label: demoPending ? 'Loading demo…' : 'Load synthetic demo',
      ariaLabel: 'Load synthetic demo',
      onClick: onLoadDemo,
      disabled: demoPending,
      secondary: true,
    },
  ];

  if (state.hasExtraction && !state.hasHistory) {
    eyebrow = 'Up next · Step 2 of 5';
    title = 'Add your Wallet history';
    description =
      'Your history teaches the app which categories you already use. It stays on this device and only lasts for this session.';
    actions = [{ label: 'Choose history CSV', onClick: onImportHistory }];
  } else if (
    state.hasHistory &&
    (!state.providerConfigured || state.providerReachable === null)
  ) {
    eyebrow = 'Up next · Step 3 of 5';
    title = 'Connect your local categorization model';
    description =
      'Confirm the local model address once. The connection test does not send any statement data.';
    actions = [
      {
        label: 'Set up local model',
        onClick: onConfigureProvider,
      },
    ];
  } else if (
    state.hasHistory &&
    state.providerReachable === false &&
    !state.hasProposals
  ) {
    eyebrow = 'Choose what to do · Step 3 of 5';
    title = 'The local model is unavailable';
    description =
      'You can check the model setup, or continue now and manually review any categories the app cannot confidently match.';
    actions = [
      { label: 'Review model setup', onClick: onConfigureProvider },
      {
        label: 'Continue without model',
        onClick: onCategorize,
        secondary: true,
      },
    ];
  } else if (state.hasHistory && !state.hasProposals) {
    eyebrow = 'Ready · Step 3 of 5';
    title = 'Match categories to your transactions';
    description =
      'The app will use your history and local model to suggest categories. Suggestions still require your approval.';
    actions = [{ label: 'Start matching categories', onClick: onCategorize }];
  } else if (state.hasProposals && !reviewComplete) {
    eyebrow = 'Up next · Step 4 of 5';
    title =
      state.needsReviewCount > 0
        ? `Review ${state.needsReviewCount} transaction${state.needsReviewCount === 1 ? '' : 's'}`
        : 'Review category suggestions';
    description =
      'Check the suggested category, amount, and any warnings. Approve, edit, split, or exclude each item.';
    actions = [{ label: 'Continue review', onClick: onReview }];
  } else if (reviewComplete && state.isDemo) {
    eyebrow = 'Demo complete';
    title = 'You have finished the practice workflow';
    description =
      'Wallet sending is disabled for sample data. Clear the demo when you are ready to import a real statement.';
    actions = [{ label: 'Review sample results', onClick: onReview }];
  } else if (reviewComplete) {
    eyebrow = 'Optional · Step 5 of 5';
    title = `${state.approvedCount} approved transaction${state.approvedCount === 1 ? '' : 's'} ready for Wallet`;
    description =
      'Connect Wallet, check the exact destination and records in a dry run, then confirm only when everything looks right.';
    actions = [{ label: 'Set up Wallet transfer', onClick: onWalletSetup }];
  }

  return (
    <section className="journey" aria-labelledby="onboarding-title">
      <div className="journey__heading">
        <div>
          <p className="journey__label">Getting started — onboarding</p>
          <h2 id="onboarding-title">Your import path</h2>
        </div>
        <span className="journey__privacy-badge">
          <span aria-hidden="true">●</span> Local session
        </span>
      </div>

      <ol className="journey__steps" aria-label="Import progress">
        {steps.map((step) => (
          <li
            key={step.id}
            className={`journey-step journey-step--${step.status}`}
            aria-current={step.status === 'active' ? 'step' : undefined}
          >
            <span className="journey-step__marker" aria-hidden="true">
              {step.status === 'complete' ? '✓' : step.id}
            </span>
            <span className="journey-step__copy">
              <span className="journey-step__short">{step.shortTitle}</span>
              <span className="journey-step__title">{step.title}</span>
            </span>
            <span className="sr-only">
              {step.status === 'complete'
                ? 'Complete'
                : step.status === 'active'
                  ? 'Current step'
                  : step.status === 'optional'
                    ? 'Optional'
                    : 'Available after earlier steps'}
            </span>
          </li>
        ))}
      </ol>

      <div className="next-action" aria-live="polite">
        <div className="next-action__copy">
          <p className="next-action__eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="next-action__buttons">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={
                action.secondary ? 'button-secondary' : 'button-primary'
              }
              onClick={action.onClick}
              disabled={action.disabled}
              aria-label={action.ariaLabel}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <details className="privacy-details">
        <summary>How your data is handled</summary>
        <p>
          Statement files, history, and category suggestions stay in this local
          session. They are removed when you clear the session or close the
          local service. Wallet is contacted only if you complete the optional
          final step and explicitly confirm the transfer.
        </p>
      </details>

      {state.isDemo && (
        <div className="demo-notice" role="status" aria-live="polite">
          <strong>Practice mode:</strong> this is synthetic data, not a
          financial record. Sending to Wallet is disabled.
        </div>
      )}
    </section>
  );
}
