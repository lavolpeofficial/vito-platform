import Link from 'next/link';
import { MountainMark } from '@/components/mountain';
import { metrics, opportunities, partner } from '@/lib/demo-data';

function money(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export default function DashboardPage() {
  const next = opportunities[0];
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Gemeinsam höher.</span>
          <h1>Willkommen, {partner.name}.</h1>
          <p>Dein Partner-Cockpit verbindet Wissen, Leads, Opportunities, Autorisierung und Vergütung in einem kontrollierten Arbeitsfluss.</p>
        </div>
        <MountainMark />
      </section>

      <section className="next-action">
        <div>
          <span className="eyebrow">Nächster sinnvoller Schritt</span>
          <h2>{next.company}</h2>
          <p>{next.nextAction} · {next.primaryPath} · fällig {next.due}</p>
        </div>
        <Link className="button primary" href={'/opportunities/' + next.id}>Opportunity öffnen</Link>
      </section>

      <section className="metric-grid">
        <article><span>Aktive Leads</span><strong>{metrics.activeLeads}</strong></article>
        <article><span>Opportunities</span><strong>{metrics.opportunities}</strong></article>
        <article><span>Pipeline</span><strong>{money(metrics.pipeline)}</strong></article>
        <article><span>ADOREN offen</span><strong>{metrics.adorePending}</strong></article>
        <article><span>Provision offen</span><strong>{money(metrics.commissionPending)}</strong></article>
        <article><span>Provision freigegeben</span><strong>{money(metrics.commissionEligible)}</strong></article>
      </section>

      <section className="split-grid">
        <article className="panel">
          <div className="section-head"><div><span className="eyebrow">Heute</span><h2>Aktive Arbeit</h2></div><span className="counter">{metrics.tasksToday}</span></div>
          <div className="list">
            {opportunities.slice(0, 3).map((item) => (
              <Link key={item.id} href={'/opportunities/' + item.id} className="list-row">
                <div><strong>{item.company}</strong><small>{item.nextAction}</small></div>
                <span className={'stage stage-' + item.stage.toLowerCase()}>{item.stage}</span>
              </Link>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="section-head"><div><span className="eyebrow">Academy</span><h2>Dein Autorisierungsweg</h2></div><strong>{partner.academyProgress}%</strong></div>
          <div className="progress"><span style={{ width: partner.academyProgress + '%' }} /></div>
          <div className="authorization-path">
            <div className="done"><strong>REFERRAL_ONLY</strong><small>abgeschlossen</small></div>
            <div className="current"><strong>SALES_ALLOWED</strong><small>3 von 5 Modulen</small></div>
            <div><strong>ADVISORY_ALLOWED</strong><small>gesperrt</small></div>
          </div>
          <Link className="text-link" href="/academy">Academy fortsetzen →</Link>
        </article>
      </section>

      <section className="journey">
        {['Partner werden','Wissen aufbauen','Kunden gewinnen','Bedarf verstehen','Passende Lösung','Wert liefern','Gemeinsam wachsen'].map((label, index) => (
          <div key={label}><b>{String(index + 1).padStart(2, '0')}</b><span>{label}</span></div>
        ))}
      </section>
    </>
  );
}
