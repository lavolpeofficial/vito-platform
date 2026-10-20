import Link from 'next/link';
import { academyModules, commissions, metrics, opportunities, partner, solutions } from '@/lib/demo-data';

function money(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

const journey = [
  ['01', 'Partner werden', 'Prüfen · Vertrag · Autorisieren'],
  ['02', 'Wissen aufbauen', 'Academy · Training · Zertifizierung'],
  ['03', 'Kunden gewinnen', 'Akquise · Leads · Empfehlungen'],
  ['04', 'Bedarf verstehen', 'ADOREN · Qualification · Discovery'],
  ['05', 'Passende Lösung', 'Routing · Angebot · Entscheidung'],
  ['06', 'Wert liefern', 'Projekt · CARE · Ergebnis'],
  ['07', 'Gemeinsam wachsen', 'Entwicklung · Vergütung · Chancen'],
] as const;

const lifecycle = [
  ['Apply', 'Bewerben'], ['Screen', 'Prüfen'], ['Approve', 'Freigeben'], ['Contract', 'Vertrag'],
  ['Verify', 'Verifizieren'], ['Train', 'Training'], ['Certify', 'Zertifizieren'], ['Authorize', 'Autorisieren'],
  ['Activate', 'Aktivieren'], ['Produce', 'Produzieren'], ['Review', 'Überprüfen'], ['Develop', 'Entwickeln'], ['Offboard', 'Beenden'],
] as const;

const trust = [
  ['EU', 'EU-orientierte Infrastruktur'],
  ['RBAC', 'Rollen & Rechte'],
  ['GDPR', 'Datenschutz'],
  ['AUDIT', 'Audit & Logging'],
  ['ENC', 'Verschlüsselung'],
  ['B/R', 'Backup & Recovery'],
] as const;

export default function DashboardPage() {
  const next = opportunities[0];
  const visibleAcademy = academyModules.slice(0, 4);
  const visibleOpportunities = opportunities.slice(0, 4);
  const visibleCommissions = commissions.slice(0, 3);

  return (
    <div className="northstar-home">
      <section className="northstar-hero bridge-hero">
        <div className="northstar-brand-copy">
          <span className="eyebrow">CONNECTING PEOPLE · CREATING OPPORTUNITIES</span>
          <h1>URTALI PARTNER</h1>
          <h2>Partner Operating System</h2>
          <p><strong>Gemeinsam weiter.</strong><br />Menschen verbinden. Chancen erkennen. Nachhaltig wachsen.</p>
        </div>

        <div className="northstar-values">
          <div><b>01</b><span><strong>Klare Prozesse</strong><small>Von der Orientierung zur Lösung</small></span></div>
          <div><b>02</b><span><strong>Starke Partner</strong><small>Wissen, Werkzeuge und Unterstützung</small></span></div>
          <div><b>03</b><span><strong>Echte Werte</strong><small>Für Kunden, Partner und Unternehmen</small></span></div>
          <div><b>04</b><span><strong>Nachhaltiges Wachstum</strong><small>Heute und morgen</small></span></div>
        </div>
      </section>

      <section className="northstar-journey" aria-label="Partner journey">
        {journey.map(([number, title, detail]) => (
          <article key={number}>
            <b>{number}</b>
            <div><strong>{title}</strong><small>{detail}</small></div>
          </article>
        ))}
      </section>

      <section className="northstar-primary-grid">
        <article className="northstar-workcard dashboard-card">
          <header><span className="workcard-icon">DB</span><div><h2>Dashboard</h2><p>Dein nächster sinnvoller Schritt. Alles Wichtige auf einen Blick.</p></div></header>
          <div className="workcard-body">
            <div className="mini-next-action">
              <span className="eyebrow">Nächste Aktion</span>
              <strong>{next.company}</strong>
              <small>{next.nextAction} · {next.primaryPath}</small>
              <Link href={'/opportunities/' + next.id}>Opportunity öffnen →</Link>
            </div>
            <div className="mini-metrics">
              <div><strong>{metrics.activeLeads}</strong><span>Leads</span></div>
              <div><strong>{metrics.opportunities}</strong><span>Opportunities</span></div>
              <div><strong>{money(metrics.pipeline)}</strong><span>Pipeline</span></div>
              <div><strong>{metrics.adorePending}</strong><span>ADOREN offen</span></div>
              <div><strong>{money(metrics.commissionPending)}</strong><span>Provision offen</span></div>
              <div><strong>{partner.academyProgress}%</strong><span>Academy</span></div>
            </div>
          </div>
        </article>

        <article className="northstar-workcard academy-card">
          <header><span className="workcard-icon">AC</span><div><h2>Academy</h2><p>Dein Weg zur nächsten Autorisierung. Kurz, praxisnah, zertifiziert.</p></div></header>
          <div className="workcard-body">
            <div className="academy-mini-head"><strong>Academy</strong><span>{partner.academyProgress}%</span></div>
            <div className="progress"><span style={{ width: partner.academyProgress + '%' }} /></div>
            <div className="academy-mini-list">
              {visibleAcademy.map((module) => (
                <Link href={'/academy/' + module.id} key={module.id} className="academy-mini-row">
                  <b>{module.status === 'COMPLETED' ? '✓' : module.id.replace('A','')}</b>
                  <span><strong>{module.title}</strong><small>{module.minutes} Min</small></span>
                </Link>
              ))}
            </div>
            <div className="authorization-mini">
              <div className="done"><strong>REFERRAL_ONLY</strong><small>abgeschlossen</small></div>
              <div className="current"><strong>SALES_ALLOWED</strong><small>aktiv</small></div>
              <div><strong>ADVISORY_ALLOWED</strong><small>gesperrt</small></div>
            </div>
            <Link className="northstar-inline-link" href="/academy">Academy öffnen →</Link>
          </div>
        </article>

        <article className="northstar-workcard leads-card">
          <header><span className="workcard-icon">LO</span><div><h2>Leads & Opportunities</h2><p>Von der ersten Anfrage bis zum Abschluss. Transparent und strukturiert.</p></div></header>
          <div className="workcard-body">
            <div className="mini-tabs"><strong>Opportunities</strong><Link href="/leads/new">+ Lead registrieren</Link></div>
            <div className="mini-table">
              {visibleOpportunities.map((item) => (
                <Link href={'/opportunities/' + item.id} key={item.id}>
                  <strong>{item.company}</strong>
                  <span className={'stage stage-' + item.stage.toLowerCase()}>{item.stage}</span>
                  <small>{item.nextAction}</small>
                </Link>
              ))}
            </div>
            <Link className="northstar-inline-link" href="/opportunities">Alle Opportunities →</Link>
          </div>
        </article>

        <article className="northstar-workcard commissions-card">
          <header><span className="workcard-icon">CO</span><div><h2>Provisionen</h2><p>Erfolge transparent vergütet. Einfach nachvollziehbar.</p></div></header>
          <div className="workcard-body">
            <div className="commission-kpis">
              <div><strong>{money(metrics.commissionPending)}</strong><span>Pending</span></div>
              <div><strong>{money(metrics.commissionEligible)}</strong><span>Eligible</span></div>
              <div><strong>{money(metrics.paidYtd)}</strong><span>Paid YTD</span></div>
            </div>
            <div className="commission-mini-table">
              {visibleCommissions.map((row) => (
                <div key={row.opportunity}>
                  <strong>{row.opportunity}</strong><span>{money(row.cnr)}</span><span>{row.rate}%</span><b className={'stage stage-' + row.status.toLowerCase()}>{row.status}</b>
                </div>
              ))}
            </div>
            <Link className="northstar-inline-link" href="/commissions">Alle Provisionen →</Link>
          </div>
        </article>
      </section>

      <section className="northstar-shortcuts">
        <Link href="/solutions"><b>SO</b><span><strong>Lösungen</strong><small>Alle Angebote verstehen. Wann einsetzen, wie positionieren, welche Vorteile.</small></span></Link>
        <Link href="/documents"><b>DO</b><span><strong>Dokumente</strong><small>Zentrale Bibliothek. Aktuelle Versionen, Vorlagen, Cases, Verträge.</small></span></Link>
        <Link href="/support"><b>SU</b><span><strong>Support</strong><small>VITO, Wissen und menschliche Eskalation an einem Ort.</small></span></Link>
        <Link href="/profile"><b>PR</b><span><strong>Profil</strong><small>Rolle, Berechtigungen, Portfolio, Autorisierung und Zertifikate.</small></span></Link>
      </section>

      <section className="northstar-lower-grid">
        <article className="northstar-lifecycle panel">
          <div className="section-head"><div><span className="eyebrow">Partner Lifecycle</span><h2>Vom ersten Kontakt bis zur langfristigen Entwicklung.</h2></div></div>
          <div className="lifecycle-track">
            {lifecycle.map(([code, label], index) => (
              <div key={code}>
                <b>{index + 1}</b>
                <span>{label}</span>
                <small>{code}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="northstar-role panel">
          <span className="eyebrow">Rolle, Autorisierung & Portfolio</span>
          <div className="role-summary">
            <div><span>Deine Rolle</span><strong>{partner.role}</strong></div>
            <div><span>Autorisierungslevel</span><strong>{partner.authorization}</strong></div>
          </div>
          <div className="portfolio-mini">
            {solutions.map((solution) => (
              <div key={solution.id}><strong>{solution.name}</strong><span>{solution.permission}</span></div>
            ))}
          </div>
          <Link className="northstar-inline-link" href="/profile">Profil & Rechte →</Link>
        </article>

        <article className="northstar-trust panel">
          <span className="eyebrow">Trust & Governance</span>
          <h2>Sicher. Transparent. Verantwortungsbewusst.</h2>
          <div className="trust-grid">
            {trust.map(([code, label]) => <div key={code}><b>{code}</b><span>{label}</span></div>)}
          </div>
          <Link className="northstar-inline-link" href="/policies">Policies & Governance →</Link>
        </article>
      </section>
    </div>
  );
}
