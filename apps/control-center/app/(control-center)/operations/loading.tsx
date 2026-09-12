export default function OperationsLoading() {
  return (
    <section className="operations-page" aria-busy="true" aria-live="polite">
      <div className="breadcrumb"><span>Control Center</span><span>/</span><span>Operations</span></div>
      <span className="eyebrow">READ-ONLY OPERATIONS</span>
      <div className="operations-loading-grid" aria-label="Loading live VITO operations telemetry">
        {Array.from({ length: 6 }, (_, index) => <div className="operations-loading-card" key={index} />)}
      </div>
    </section>
  );
}
