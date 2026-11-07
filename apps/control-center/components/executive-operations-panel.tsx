import type { ExecutiveOperationsSnapshot } from '@/lib/executive/operations-gate';

type Props = Readonly<{ permitted: boolean; snapshot: ExecutiveOperationsSnapshot | null }>;

function localTime(value: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome',
  }).format(new Date(value));
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
      <span style={{ display: 'block', fontSize: 13 }}>{label}</span>
      <strong style={{ fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString('de-DE')}</strong>
    </div>
  );
}

/** Existing ONE COCKPIT, never a second dashboard or untrusted BUS overview. */
export function ExecutiveOperationsPanel({ permitted, snapshot }: Props) {
  return (
    <section aria-labelledby="executive-operations-title" className="boundary-notice">
      <span className="system-dot" />
      <div style={{ width: '100%', minWidth: 0 }}>
        <strong id="executive-operations-title">VITO · Betriebs- und Entscheidungsübersicht</strong>
        {!permitted ? (
          <p>Nur OWNER und ADMIN können diese Übersicht einsehen.</p>
        ) : !snapshot ? (
          <p>Operations-Daten aktuell nicht sicher verfügbar. Status unbekannt – keine Nullwerte und keine Erfolge werden angenommen.</p>
        ) : (
          <>
            <p>Geprüfte, mandantengebundene Betriebsdaten · {localTime(snapshot.observedAt)} (Italien). Kein Nachweis über fachliche Aufgabenerledigung.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px 16px' }}>
              <Metric label="Workflows insgesamt" value={snapshot.totalWorkflows} />
              <Metric label="Blockiert" value={snapshot.blocked} />
              <Metric label="Fehlgeschlagen" value={snapshot.failed} />
              <Metric label="Laufend" value={snapshot.running} />
              <Metric label="Wartend" value={snapshot.pending} />
              <Metric label="Prüfungen offen" value={snapshot.governanceReviews} />
              <Metric label="Provider-Lücken" value={snapshot.providerGaps} />
              <Metric label="Digitale Mitarbeiter" value={snapshot.digitalEmployees} />
            </div>
            <div style={{ marginTop: 12 }}>
              <strong>Technische Eskalationen</strong>
              {snapshot.recentAttention.length === 0 ? (
                <p>Keine gemeldeten Blockaden oder Fehler im begrenzten Aufmerksamkeitssnapshot. Andere Quellen können weiterhin offen sein.</p>
              ) : (
                <div role="list" aria-label="Technische Eskalationen">
                  {snapshot.recentAttention.map(item => (
                    <div role="listitem" key={item.id} style={{ borderTop: '1px solid var(--line)', padding: '9px 0' }}>
                      <strong>{item.status} · {item.reason ?? 'Ohne angegebenen Grundcode'}</strong>
                      <p>{localTime(item.updatedAt)} · ID: {item.id}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
