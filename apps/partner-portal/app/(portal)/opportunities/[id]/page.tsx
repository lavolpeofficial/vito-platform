import Link from 'next/link';
import { notFound } from 'next/navigation';
import { opportunities } from '@/lib/demo-data';
import { OpportunityActions } from '@/components/opportunity-actions';

function money(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = opportunities.find((entry) => entry.id === id);
  if (!item) notFound();

  return (
    <>
      <div className="breadcrumb"><Link href="/opportunities">Opportunities</Link><span>→</span><span>{item.company}</span></div>
      <header className="opportunity-hero">
        <div><span className="eyebrow">Opportunity</span><h1>{item.company}</h1><p>{item.primaryPath}</p></div>
        <div className="opportunity-value"><span>Value</span><strong>{money(item.value)}</strong><b className={'stage stage-' + item.stage.toLowerCase()}>{item.stage}</b></div>
      </header>
      <section className="detail-grid">
        <article className="panel"><span className="eyebrow">Qualification</span><div className="score-grid">
          {['need','impact','clarity','readiness','fit'].map((key) => <div key={key}><span>{key}</span><strong>{String(item[key as keyof typeof item])}</strong></div>)}
        </div></article>
        <article className="panel"><span className="eyebrow">Next Action</span><h2>{item.nextAction}</h2><p>Fällig: {item.due}</p><button className="button primary" type="button">Task öffnen</button></article>
        <article className="panel"><span className="eyebrow">ADOREN</span><h2>Business Summary</h2><p>Primary Area: Processi & operazioni<br />Secondary: Sistemi & dati<br />Confidence: MEDIUM</p><div className="scope-guard">Nur freigegebene B2B-Zusammenfassung. Keine persönliche Evidenz.</div></article>
        <article className="panel"><span className="eyebrow">Partner</span><h2>{item.partnerRole}</h2><p>Opportunity Role und Provision werden separat vom Account-Status geführt.</p></article>
      </section>
      <OpportunityActions company={item.company} />
    </>
  );
}
