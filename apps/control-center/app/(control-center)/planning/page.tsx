import './planning.css';
import { PlanningClient } from './planning-client';

export const metadata = { title: 'Goal & Planning' };

export default function PlanningPage() {
  return <main>
    <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Goal & Planning</span></div>
    <section className="module-heading"><div className="module-icon">GP</div><div><span className="eyebrow">Intent → governed plan</span><h1>Goal & Planning</h1><p>Menschliche Ziele in einen serverseitig erzeugten, evidenzgestützten und nicht automatisch ausführbaren VITO-Plan überführen.</p></div></section>
    <div className="boundary-notice"><span className="system-dot" /><div><strong>Planung ist keine Ausführung</strong><p>Der Goal Planner bleibt authoritative. Das Frontend zeigt Knowledge, Memory, Capability Mapping und Governance Boundaries, ohne Provider- oder Capability-Overrides und ohne automatische Workflow-Erzeugung.</p></div></div>
    <PlanningClient />
  </main>;
}
