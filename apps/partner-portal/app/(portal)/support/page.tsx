const support = [
  ['Sales', 'Routing, Angebot, Portfolio'],
  ['Commercial', 'Preisabweichung, Vertrag'],
  ['Finance', 'CNR, Provision, Auszahlung'],
  ['Technical', 'Portal, Demo, Login'],
  ['Privacy & Compliance', 'Datenschutz, Claims, Policies'],
  ['Customer Escalation', 'Beschwerde oder kritischer Fall'],
];

export default function SupportPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Support</span>
        <h1>Support & VITO</h1>
        <p>Wissen zuerst, Copilot danach, menschliche Eskalation wo Verantwortung erforderlich ist.</p>
      </header>
      <section className="support-grid">
        <article className="vito-card"><span className="eyebrow">VITO Partner Copilot</span><h2>Integration vorbereitet</h2><p>VITO soll später Authorization, Portfolio und Opportunity-Kontext berücksichtigen. In dieser Review-Version werden keine produktiven Agenten aufgerufen.</p><button className="button secondary" disabled>VITO noch nicht verbunden</button></article>
        <article className="panel"><span className="eyebrow">Human Support</span>{support.map(([name, desc]) => <div className="support-row" key={name}><strong>{name}</strong><span>{desc}</span><button type="button" disabled>nach Integration</button></div>)}</article>
      </section>
    </>
  );
}
