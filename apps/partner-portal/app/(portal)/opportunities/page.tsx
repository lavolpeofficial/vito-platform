import Link from 'next/link';
import { opportunities } from '@/lib/demo-data';

function money(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export default function OpportunitiesPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Pipeline</span>
        <h1>Opportunities</h1>
        <p>Ein Primary Path, eine nächste Aktion, ein klarer Owner. Keine Opportunity ohne Qualification und Next Action.</p>
      </header>
      <div className="table-card">
        <div className="data-table opportunity-table">
          <div className="data-row data-header"><span>Company</span><span>Stage</span><span>Primary Path</span><span>Value</span><span>Next Action</span></div>
          {opportunities.map((item) => (
            <Link href={'/opportunities/' + item.id} className="data-row" key={item.id}>
              <strong>{item.company}</strong>
              <span><b className={'stage stage-' + item.stage.toLowerCase()}>{item.stage}</b></span>
              <span>{item.primaryPath}</span>
              <span>{money(item.value)}</span>
              <span>{item.nextAction} · {item.due}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
