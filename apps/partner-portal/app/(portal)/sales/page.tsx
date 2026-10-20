import Link from 'next/link';
import { salesAssets } from '@/lib/content';

export default function SalesPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Sales Enablement</span>
        <h1>Sales Hub</h1>
        <p>Nur freigegebene, aktuelle Versionen. Akquise, Discovery und Cases bleiben einheitlich und governance-fähig.</p>
      </header>
      <div className="filter-bar"><span>Sprache: Alle</span><span>Offer: Alle</span><span>Asset: Alle</span><span>Status: REVIEW APPROVED</span></div>
      <section className="asset-grid">
        {salesAssets.map((asset) => (
          <article className="asset-card" key={asset.slug}>
            <span className="asset-type">{asset.category}</span>
            <h2>{asset.title}</h2>
            <p>{asset.summary}</p>
            <p>{asset.language} · v{asset.version} · {asset.status}</p>
            <Link className="button secondary" href={'/sales/' + asset.slug}>Öffnen</Link>
          </article>
        ))}
      </section>
    </>
  );
}
