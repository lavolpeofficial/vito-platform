import { partner, solutions } from '@/lib/demo-data';
import { canUseOffer } from '@/lib/domain';

export default function SolutionsPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Portfolio</span>
        <h1>Solutions</h1>
        <p>Jede Lösung hat klare Einsatzgrenzen, Preisrahmen und Partnerrechte. Partnerstatus bedeutet nicht automatisch Verkaufsbefugnis.</p>
      </header>
      <section className="solution-grid">
        {solutions.map((solution) => {
          const salesAllowed = canUseOffer(partner.authorization, solution.permission, 'SALES_ALLOWED');
          return (
            <article className="solution-card" key={solution.id}>
              <div className="solution-top"><span>{solution.label}</span><b className={salesAllowed ? 'permit permit-ok' : 'permit'}>{salesAllowed ? 'VERKAUF ERLAUBT' : solution.permission}</b></div>
              <h2>{solution.name}</h2>
              <p>{solution.problem}</p>
              <dl>
                <div><dt>Preisband</dt><dd>{solution.price}</dd></div>
                <div><dt>Typical Target</dt><dd>{solution.target}</dd></div>
                <div><dt>Wann einsetzen?</dt><dd>{solution.useWhen}</dd></div>
                <div><dt>Wann nicht?</dt><dd>{solution.avoidWhen}</dd></div>
                <div><dt>Nächster Pfad</dt><dd>{solution.next}</dd></div>
              </dl>
            </article>
          );
        })}
      </section>
    </>
  );
}
