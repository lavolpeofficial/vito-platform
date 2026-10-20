import { academyModules, partner } from '@/lib/demo-data';

export default function AcademyPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Enablement</span>
        <h1>Academy</h1>
        <p>Kurze, praxisnahe Module. Zertifizierung und Autorisierung bleiben getrennt und nachvollziehbar.</p>
      </header>
      <section className="academy-status panel">
        <div><span>Aktueller Stand</span><strong>{partner.authorization}</strong></div>
        <div className="grow"><div className="progress"><span style={{ width: partner.academyProgress + '%' }} /></div><small>{partner.academyProgress}% abgeschlossen</small></div>
        <div><span>Nächstes Gate</span><strong>ADVISORY_ALLOWED</strong></div>
      </section>
      <section className="module-list">
        {academyModules.map((module) => (
          <article key={module.id} className={'module-row module-' + module.status.toLowerCase()}>
            <div className="module-number">{module.id}</div>
            <div><strong>{module.title}</strong><small>{module.minutes} Min · {module.status.replaceAll('_', ' ')}</small></div>
            <div className="module-action">{module.status === 'COMPLETED' ? '✓' : module.status === 'LOCKED' ? '—' : 'Öffnen'}</div>
          </article>
        ))}
      </section>
    </>
  );
}
