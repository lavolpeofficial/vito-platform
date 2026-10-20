const areas = [
  ['Login / Apply', 'READY FOR OWNER REVIEW', 'Kein Auth0, keine Speicherung'],
  ['Dashboard', 'READY FOR OWNER REVIEW', 'One visible primary action'],
  ['Academy', 'READY FOR OWNER REVIEW', 'Module + Authorization Path + Quiz'],
  ['Solutions', 'READY FOR OWNER REVIEW', 'Portfolio permissions sichtbar'],
  ['Sales Hub', 'READY FOR OWNER REVIEW', 'Versionierte Review Assets'],
  ['Leads', 'READY FOR OWNER REVIEW', 'Nur browser-lokal im Review Mode'],
  ['Opportunities', 'READY FOR OWNER REVIEW', 'Qualification + ADOREN B2B boundary'],
  ['Documents', 'READY FOR OWNER REVIEW', 'APPROVED + CURRENT Logik'],
  ['Commissions', 'READY FOR OWNER REVIEW', 'Invoice != Payment != CNR != Ledger'],
  ['Admin Control Center', 'READY FOR OWNER REVIEW', 'Applications, Conflicts, Authorizations, Governance'],
];

const blocked = [
  'Auth0 EU identity/session contract',
  'Prisma data model + migrations',
  'NestJS API writes',
  'AuditService wiring',
  'ADOREN live B2B summary adapter',
  'VITO Partner Copilot',
  'real document storage',
  'real payment/CNR ledger',
  'staging browser acceptance',
  'public route / production deployment',
];

export default function ReviewPage() {
  return (
    <>
      <header className="page-head"><span className="eyebrow">Owner Control</span><h1>Review Checklist</h1><p>Diese Seite markiert exakt, was du jetzt visuell prüfen kannst und was bewusst noch nicht produktiv verbunden ist.</p></header>
      <section className="review-grid">
        <article className="panel"><span className="eyebrow">Jetzt prüfen</span><div className="review-list">{areas.map(([area,status,note])=><div key={area}><div><strong>{area}</strong><small>{note}</small></div><b className="stage stage-accepted">{status}</b></div>)}</div></article>
        <article className="panel"><span className="eyebrow">Bewusst blockiert</span><h2>Nach Owner-UX-Freigabe</h2><ul className="learning-list">{blocked.map((item)=><li key={item}>{item}</li>)}</ul><div className="scope-guard">Kein Merge, keine DB-Migration, keine produktive Route ohne nächste explizite Freigabe.</div></article>
      </section>
    </>
  );
}
