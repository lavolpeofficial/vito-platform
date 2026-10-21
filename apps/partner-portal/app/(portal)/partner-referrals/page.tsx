const referrals = [
  ['Giulia R.','INVITED','—','No bonus'],
  ['Marco B.','CONTRACTED','Training offen','No bonus'],
  ['Paolo S.','ACTIVATED','Erster Lead dokumentiert','€350 eligible'],
];

export default function PartnerReferralsPage() {
  return (
    <>
      <header className="page-head"><span className="eyebrow">Partner Recruiter</span><h1>Partner Referrals</h1><p>Kein Downline-Modell. Ein Aktivierungsbonus entsteht erst nach Vertrag, Pflichttraining, Authorization und dokumentierter Aktivität.</p></header>
      <div className="table-card">
        <div className="data-table referral-table">
          <div className="data-row data-header"><span>Partner</span><span>Status</span><span>Activation Evidence</span><span>Bonus</span></div>
          {referrals.map(([name,status,evidence,bonus]) => <div className="data-row" key={name}><strong>{name}</strong><span><b className={'stage ' + (status === 'ACTIVATED' ? 'stage-accepted' : 'stage-review')}>{status}</b></span><span>{evidence}</span><span>{bonus}</span></div>)}
        </div>
      </div>
      <div className="formula-note">INVITE ≠ BONUS · ACTIVATED = CONTRACT + TRAINING + AUTHORIZATION + DOKUMENTIERTE AKTIVITÄT</div>
    </>
  );
}
