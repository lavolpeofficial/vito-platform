const assets = [
  ['Akquise Erstkontakt · Italien', 'EMAIL_TEMPLATE', 'IT', 'v2.1'],
  ['Telefonleitfaden · KMU', 'PHONE_SCRIPT', 'IT', 'v1.4'],
  ['Discovery Guide', 'DISCOVERY_GUIDE', 'DE / IT', 'v1.0'],
  ['Einwandbehandlung · Preis & KI', 'OBJECTION_HANDLING', 'IT', 'v1.1'],
  ['Lead Flow Demo', 'DEMO', 'DE / IT', 'v0.8'],
  ['Automotive Solution Case', 'CASE', 'IT', 'v1.0'],
];

export default function SalesPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Sales Enablement</span>
        <h1>Sales Hub</h1>
        <p>Nur freigegebene, aktuelle Versionen. Akquise, Discovery und Cases bleiben einheitlich und governance-fähig.</p>
      </header>
      <div className="filter-bar"><span>Sprache: Alle</span><span>Offer: Alle</span><span>Asset: Alle</span><span>Status: APPROVED</span></div>
      <section className="asset-grid">
        {assets.map(([title, type, language, version]) => (
          <article className="asset-card" key={title}>
            <span className="asset-type">{type}</span>
            <h2>{title}</h2>
            <p>{language} · {version} · APPROVED</p>
            <button className="button secondary" type="button" disabled title="Asset storage is not connected in review mode">Vorschau · nach Integration</button>
          </article>
        ))}
      </section>
    </>
  );
}
