import { commissions, metrics } from '@/lib/demo-data';

function money(value: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

export default function CommissionsPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Finance</span>
        <h1>Provisionen</h1>
        <p>Rechnung, Zahlung, CNR und Provisionsanspruch bleiben getrennte Objekte. Provision entsteht erst auf eligible CNR.</p>
      </header>
      <section className="metric-grid compact-metrics">
        <article><span>Pending</span><strong>{money(metrics.commissionPending)}</strong></article>
        <article><span>Eligible</span><strong>{money(metrics.commissionEligible)}</strong></article>
        <article><span>Paid YTD</span><strong>{money(metrics.paidYtd)}</strong></article>
      </section>
      <div className="table-card">
        <div className="data-table commission-table">
          <div className="data-row data-header"><span>Opportunity</span><span>CNR</span><span>Rate</span><span>Betrag</span><span>Status</span></div>
          {commissions.map((row) => <div className="data-row" key={row.opportunity}><strong>{row.opportunity}</strong><span>{money(row.cnr)}</span><span>{row.rate}%</span><span>{money(row.amount)}</span><span><b className={'stage stage-' + row.status.toLowerCase()}>{row.status}</b></span></div>)}
        </div>
      </div>
      <div className="formula-note">CUSTOMER INVOICE → PAYMENT → ELIGIBLE CNR → COMMISSION LEDGER</div>
    </>
  );
}
