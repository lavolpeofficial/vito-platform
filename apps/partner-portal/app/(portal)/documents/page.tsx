import { documents } from '@/lib/demo-data';

export default function DocumentsPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Knowledge</span>
        <h1>Documents</h1>
        <p>Nur aktuelle, freigegebene Versionen. Alte Dateien werden nicht standardmäßig angeboten.</p>
      </header>
      <div className="filter-bar"><span>Alle Kategorien</span><span>DE / IT</span><span>APPROVED + CURRENT</span></div>
      <section className="document-list">
        {documents.map((doc) => (
          <article key={doc.title}>
            <div className="file-mark">{doc.type}</div>
            <div><strong>{doc.title}</strong><small>{doc.category} · {doc.language}</small></div>
            <div className="doc-version">v{doc.version}<small>{doc.status}</small></div>
            <button type="button" className="button secondary small" disabled title="Document storage is not connected in review mode">Noch nicht verbunden</button>
          </article>
        ))}
      </section>
    </>
  );
}
