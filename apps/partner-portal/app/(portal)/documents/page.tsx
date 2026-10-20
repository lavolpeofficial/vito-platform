import Link from 'next/link';
import { knowledgeDocuments } from '@/lib/content';

export default function DocumentsPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Knowledge</span>
        <h1>Documents</h1>
        <p>Nur aktuelle Review-Fassungen. Rechtlich verbindliche Dokumente werden vor Produktivbetrieb separat freigegeben.</p>
      </header>
      <div className="filter-bar"><span>Alle Kategorien</span><span>DE / IT</span><span>REVIEW APPROVED</span></div>
      <section className="document-list">
        {knowledgeDocuments.map((doc) => (
          <article key={doc.slug}>
            <div className="file-mark">DOC</div>
            <div><strong>{doc.title}</strong><small>{doc.category} · {doc.language}</small></div>
            <div className="doc-version">v{doc.version}<small>{doc.status}</small></div>
            <Link className="button secondary small" href={'/documents/' + doc.slug}>Öffnen</Link>
          </article>
        ))}
      </section>
    </>
  );
}
