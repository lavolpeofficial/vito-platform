import type { PortalContent } from '@/lib/content';

export function ContentView({ entry }: { entry: PortalContent }) {
  return (
    <article className="content-view">
      <header><span className="eyebrow">{entry.category} · {entry.language} · v{entry.version}</span><h1>{entry.title}</h1><p>{entry.summary}</p><b className="stage stage-accepted">{entry.status}</b></header>
      {entry.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2>{section.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
      <div className="scope-guard">Portalinhalt für Owner Review. Vertragliche/rechtliche Fassungen werden vor Produktivnutzung separat freigegeben.</div>
    </article>
  );
}
