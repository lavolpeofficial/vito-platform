import './learning.css';
import { LearningClient } from './learning-client';

export const metadata = { title: 'Learning Explorer' };

export default function LearningPage() {
  return <main>
    <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Learning Explorer</span></div>
    <section className="module-heading"><div className="module-icon">LE</div><div><span className="eyebrow">Experience → Outcome → Reflection</span><h1>Learning Explorer</h1><p>Beobachte VITOs persistierte Lernkette über die neue tenant-scoped Learning Observability API.</p></div></section>
    <div className="boundary-notice"><span className="system-dot" /><div><strong>Read-only learning surface</strong><p>Diese Oberfläche verändert keine Experience, erzeugt keine Reflection und promoted keinen Skill. Persistenz, Bewertung, Lernlogik und Governance bleiben vollständig im Backend.</p></div></div>
    <LearningClient />
  </main>;
}
