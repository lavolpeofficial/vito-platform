const policies = [
  ['Partner Agreement','1.0','ACCEPTED','20.10.2026',true],
  ['Commission Policy','1.0','ACCEPTED','20.10.2026',true],
  ['Lead Protection Policy','1.0','ACCEPTED','20.10.2026',true],
  ['Sales Policy','1.1','ACK_REQUIRED','—',true],
  ['Code of Conduct','1.0','ACCEPTED','20.10.2026',true],
  ['Privacy & Data Handling','1.0','ACCEPTED','20.10.2026',true],
  ['Brand Usage Policy','1.0','ACCEPTED','20.10.2026',false],
];

export default function PoliciesPage() {
  return (
    <>
      <header className="page-head"><span className="eyebrow">Governance</span><h1>Policies</h1><p>Version, Gültigkeit und Bestätigung sind Teil der Berechtigungslogik. Relevante Änderungen können eine erneute Bestätigung erzwingen.</p></header>
      <div className="table-card">
        <div className="data-table policy-table">
          <div className="data-row data-header"><span>Policy</span><span>Version</span><span>Status</span><span>Accepted</span><span>Reaccept</span></div>
          {policies.map(([name,version,status,date,reaccept]) => <div className="data-row" key={String(name)}><strong>{String(name)}</strong><span>v{String(version)}</span><span><b className={'stage ' + (status === 'ACCEPTED' ? 'stage-accepted' : 'stage-review')}>{String(status)}</b></span><span>{String(date)}</span><span>{reaccept ? 'bei Änderung' : 'optional'}</span></div>)}
        </div>
      </div>
      <div className="scope-guard policy-note">ACK_REQUIRED kann in Produktion definierte Aktionen sperren, bis die neue Version bestätigt wurde.</div>
    </>
  );
}
