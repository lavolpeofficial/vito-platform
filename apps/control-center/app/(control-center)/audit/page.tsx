import './audit.css';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseAuditEvents, type AuditEvent } from '@/lib/audit/contracts';

export const metadata = { title: 'Audit & Activity' };

export default async function AuditPage() {
  let events: readonly AuditEvent[] = [];
  let loadError: string | null = null;
  try {
    const client = await createAuthenticatedVitoApiClient();
    events = await client.get('/audit-events', parseAuditEvents);
  } catch (caught) {
    loadError = caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR';
  }

  const users = events.filter((event) => event.actorType === 'USER').length;
  const employees = events.filter((event) => event.actorType === 'DIGITAL_EMPLOYEE').length;
  const system = events.filter((event) => event.actorType === 'SYSTEM').length;

  return <main>
    <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Audit & Activity</span></div>
    <section className="module-heading"><div className="module-icon">AU</div><div><span className="eyebrow">Immutable operational evidence</span><h1>Audit & Activity</h1><p>Tenant-scoped AuditEvents aus dem bestehenden VITO Audit Service – neueste Ereignisse zuerst.</p></div></section>
    <div className="boundary-notice"><span className="system-dot" /><div><strong>Read-only evidence</strong><p>Diese Sicht erzeugt, verändert oder löscht keine AuditEvents und erteilt keinerlei Execution Authority. Die Organization wird ausschließlich durch den serverseitigen Tenant Context bestimmt.</p></div></div>
    {loadError ? <div className="audit-banner">AuditEvents konnten nicht geladen werden: {loadError}</div> : null}
    <section className="audit-metrics"><Metric label="Events" value={events.length} /><Metric label="User" value={users} /><Metric label="Digital Employees" value={employees} /><Metric label="System" value={system} /></section>
    <section className="audit-panel"><div className="audit-head"><div><span className="eyebrow">01 · Evidence stream</span><h2>Activity Timeline</h2></div><span>{events.length} tenant-scoped events</span></div>
      {events.length === 0 ? <p className="audit-empty">Keine AuditEvents in dieser Organization.</p> : <div className="audit-list">{events.map((event) => <EventCard key={event.id} event={event} />)}</div>}
    </section>
  </main>;
}

function EventCard({ event }: Readonly<{ event: AuditEvent }>) {
  return <article className="audit-card"><div className="audit-card-top"><div><strong>{event.action}</strong><span>{formatDate(event.createdAt)}</span></div><span className={`audit-actor audit-actor-${event.actorType.toLowerCase()}`}>{event.actorType}</span></div>
    <dl className="audit-details"><Row label="Entity" value={`${event.entityType}${event.entityId ? ` · ${event.entityId}` : ''}`} /><Row label="Actor" value={event.actorId ?? 'server-owned / not specified'} /><Row label="Event ID" value={event.id} /></dl>
    <Metadata value={event.metadata} />
  </article>;
}
function Metric({ label, value }: Readonly<{ label: string; value: number }>) { return <article className="audit-metric"><span>{label}</span><strong>{value}</strong></article>; }
function Row({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Metadata({ value }: Readonly<{ value: Readonly<Record<string, unknown>> }>) { const entries = Object.entries(value); if (entries.length === 0) return null; return <details className="audit-metadata"><summary>Metadata · {entries.length} fields</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>; }
function formatDate(value: string): string { return new Date(value).toLocaleString('de-DE'); }
