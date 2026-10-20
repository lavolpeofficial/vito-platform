const applications = [
  ['Marco Bianchi','SALES_PARTNER','UNDER_REVIEW','Italia'],
  ['Laura Conti','SCOUT','APPROVED','Italia'],
  ['Daniel Weber','BUSINESS_PARTNER','CONTRACT_PENDING','Deutschland'],
];

const conflicts = [
  ['Autohaus Nord','PROTECTED_BY_OTHER_PARTNER','Commercial Review'],
  ['Studio Verde','EXISTING_CUSTOMER','Reject registration'],
];

const authorizations = [
  ['Marco Bianchi','SALES_ALLOWED','DIGITALIS Discovery','31.10.2027'],
  ['Laura Conti','REFERRAL_ONLY','ADOREN Business','30.06.2027'],
];

export default function AdminReviewPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Internal only · Owner Review</span>
        <h1>Partner Control Center</h1>
        <p>Interne Kontrollfläche für Applications, Authorizations, Konflikte, Policies, Commissions und Audit. Nicht Bestandteil der normalen Partnernavigation.</p>
      </header>
      <section className="admin-grid">
        <article className="panel"><div className="section-head"><div><span className="eyebrow">Applications</span><h2>Offene Bewerbungen</h2></div><span className="counter">3</span></div>{applications.map(([name,role,status,country])=><div className="admin-row" key={name}><div><strong>{name}</strong><small>{role} · {country}</small></div><b className={'stage stage-' + status.toLowerCase()}>{status}</b></div>)}</article>
        <article className="panel"><div className="section-head"><div><span className="eyebrow">Conflicts</span><h2>Lead-Konflikte</h2></div><span className="counter">2</span></div>{conflicts.map(([company,status,next])=><div className="admin-row" key={company}><div><strong>{company}</strong><small>{next}</small></div><b className="stage stage-review">{status}</b></div>)}</article>
        <article className="panel"><span className="eyebrow">Authorizations</span><h2>Gültigkeit & Limits</h2>{authorizations.map(([name,level,offer,until])=><div className="admin-row" key={name}><div><strong>{name}</strong><small>{offer} · bis {until}</small></div><b className="stage stage-accepted">{level}</b></div>)}</article>
        <article className="panel"><span className="eyebrow">Governance</span><h2>Owner Gates</h2><div className="governance-checks"><span>✓ Policy acceptance versioned</span><span>✓ Discount approval human-gated</span><span>✓ Commission approval human-gated</span><span>✓ Offboarding defined</span><span>✓ Audit required for critical writes</span></div></article>
      </section>
    </>
  );
}
