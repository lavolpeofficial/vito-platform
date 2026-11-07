import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NavigationIcon } from '@/components/navigation-icon';
import { getAuthenticatedSession } from '@/lib/auth/session';
import { navigationItems } from '@/lib/navigation';
import { getReceiptOverview } from '@/lib/receipt-ledger/server';
import type { ReceiptOverview } from '@/lib/receipt-ledger/contracts';
import { ExecutiveOperationsPanel } from '@/components/executive-operations-panel';
import { getOperationsSummary } from '@/lib/operations/server';
import { projectExecutiveOperations, type ExecutiveOperationsSnapshot } from '@/lib/executive/operations-gate';

export const dynamic = 'force-dynamic';

export default async function ControlCenterHome() {
  const session = await getAuthenticatedSession();
  if (!session) redirect('/login');
  const canReadExecutive = session.user.role === 'OWNER' || session.user.role === 'ADMIN';

  let ledger: ReceiptOverview | null = null;
  let operations: ExecutiveOperationsSnapshot | null = null;
  if (canReadExecutive) {
    // Independent sources: one failing provider must not hide the other.
    const [receiptsResult, operationsResult] = await Promise.allSettled([
      getReceiptOverview(),
      getOperationsSummary(),
    ]);
    if (receiptsResult.status === 'fulfilled') {
      const result = receiptsResult.value;
      const ageMs = Date.now() - Date.parse(result.observedAt);
      if (result.organizationId === session.organization.id &&
          result.sourceHealth === 'HEALTHY' &&
          ageMs >= -60_000 && ageMs <= 300_000) {
        ledger = result;
      }
    }
    if (operationsResult.status === 'fulfilled') {
      operations = projectExecutiveOperations(
        operationsResult.value,
        session.organization.id,
        Date.now(),
      );
    }
  }

  return (
    <section aria-labelledby="page-title" className="home-page">
      <div className="page-heading">
        <span className="eyebrow">VITO · Executive Control</span>
        <h1 id="page-title">ONE COCKPIT</h1>
        <p>Ein Login. Ein gemeinsamer Überblick über Nachrichten, Empfangsnachweise und offene Freigaben.</p>
      </div>

      <ExecutiveOperationsPanel permitted={canReadExecutive} snapshot={operations} />

      <section aria-labelledby="receipt-title" className="boundary-notice">
        <span className="system-dot" />
        <div>
          <strong id="receipt-title">CONTROL BUS · Auftragsübergaben</strong>
          {!canReadExecutive ? (
            <p>Zugriff nur für OWNER und ADMIN. Keine Empfangsdaten verfügbar.</p>
          ) : !ledger ? (
            <p>Datenquelle nicht sicher verbunden, nicht autorisiert oder zu alt. Empfangsstatus unbekannt; es werden keine abgeschlossenen Aufträge behauptet.</p>
          ) : (
            <>
              <p>Nur lesende, frische serverseitige Daten. Ein Empfangsbericht ist kein signiertes Agenten-ACK, kein abgeschlossener Auftrag und keine Owner-Freigabe.</p>
              <p>Beobachtet: {new Date(ledger.observedAt).toLocaleString('de-DE', { timeZone: 'Europe/Rome' })} · Übergaben in Ansicht: {ledger.items.length}</p>
              {ledger.items.length === 0 ? (
                <p>Keine Übergaben im geprüften Zeitraum. Dies ist kein Nachweis für einen leeren Gesamtbestand.</p>
              ) : (
                <div role="list" aria-label="Letzte Übergaben">
                  {ledger.items.slice(0, 10).map((item) => (
                    <div key={item.dispatchId} role="listitem" style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
                      <strong>#{item.dispatchId} · {item.recipient.toUpperCase()}</strong>
                      <p>{item.subject}</p>
                      <p>{item.receiptId
                        ? `Empfangsbericht #${item.receiptId} zugeordnet – Absender nicht authentifiziert; Umsetzung offen`
                        : 'Gesendet – keine eigenständige Empfangsbestätigung nachgewiesen'}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <div className="module-grid">
        {navigationItems.map((item, index) => (
          <Link className="module-card" href={item.href} key={item.href}>
            <span className="module-card-icon"><NavigationIcon name={item.icon} /></span>
            <span className="module-card-number">0{index + 1}</span>
            <strong>{item.label}</strong>
            <p>{item.description}</p>
            <span className="card-action">Modul öffnen <span aria-hidden="true">→</span></span>
          </Link>
        ))}
      </div>
    </section>
  );
}
