const foundations = [
  'Local-only processing by default',
  'Synthetic fixture-driven development',
  'No transaction database',
  'Explicit review before Wallet writes',
];

export function App() {
  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Phase 0 foundation</p>
        <h1 id="page-title">eSOA to Wallet</h1>
        <p className="lede">
          Turn bank statements into reviewed Wallet transactions while keeping
          financial data on this machine.
        </p>
        <div className="status" role="status">
          <span aria-hidden="true" /> Local service ready
        </div>
      </section>

      <section className="principles" aria-labelledby="principles-title">
        <h2 id="principles-title">Safety baseline</h2>
        <ul>
          {foundations.map((foundation) => (
            <li key={foundation}>{foundation}</li>
          ))}
        </ul>
        <p className="next-step">
          Statement ingestion arrives in Phase 1. This screen confirms the local
          application scaffold is running.
        </p>
      </section>
    </main>
  );
}
