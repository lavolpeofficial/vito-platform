import { partner, solutions } from '@/lib/demo-data';

export default function ProfilePage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Identity & Governance</span>
        <h1>{partner.fullName}</h1>
        <p>{partner.organization} · {partner.language}</p>
      </header>
      <section className="profile-grid">
        <article className="panel"><span className="eyebrow">Rolle</span><h2>{partner.role}</h2><p>Business Role und Opportunity Role werden getrennt geführt.</p></article>
        <article className="panel"><span className="eyebrow">Autorisierung</span><h2>{partner.authorization}</h2><p>Capability + Offer + Market + Limits + Validity.</p></article>
      </section>
      <section className="panel portfolio-panel">
        <span className="eyebrow">Authorized Portfolio</span>
        <div className="portfolio-list">
          {solutions.map((solution) => <div key={solution.id}><strong>{solution.name}</strong><span>{solution.permission}</span></div>)}
        </div>
      </section>
      <div className="owner-review-link"><a className="button secondary" href="/admin">Partner Control Center · Owner Review</a></div><section className="governance-grid">
        {['Partner Agreement · accepted','Commission Policy v1.0 · accepted','Lead Protection Policy v1.0 · accepted','Code of Conduct · accepted','Privacy & Data Handling · accepted','Brand Usage Policy · accepted'].map((item) => <div key={item}>✓ {item}</div>)}
      </section>
    </>
  );
}
