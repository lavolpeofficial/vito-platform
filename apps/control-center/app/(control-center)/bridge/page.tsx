import Link from 'next/link';
import {getAuthenticatedSession} from '@/lib/auth/session';
import {isVitoInteractiveOwner} from '@/lib/auth/owner-access';
import './bridge.css';

export const metadata={title:'BRIDGE · Interner Prüfkorb'};
export const dynamic='force-dynamic';

/**
 * New BRIDGE cockpit boundary — not a second partner portal.
 * A valid VITO login alone is insufficient: only the pinned human OWNER
 * may reach the governance area. It has NO DB connector or approvals yet.
 */
export default async function BridgeReviewPage(){
 const session=await getAuthenticatedSession();
 const ownerAuthorized=isVitoInteractiveOwner(session);
 return <section className="bridge-review" aria-labelledby="bridge-review-title">
  <div className="breadcrumb"><Link href="/">VITO Control Center</Link><span>/</span><span>BRIDGE · Prüfkorb</span></div>
  <header className="bridge-review-header">
   <span className="eyebrow">BRIDGE · HUMAN GOVERNANCE</span>
   <h1 id="bridge-review-title">Interner BRIDGE-Prüfkorb</h1>
   <p>Geschäftschancen für LA-VOLPE-Leistungen – keine allgemeine Partnervermittlung. Die Prüfung und spätere Freigabe liegen bei autorisierten internen Stellen.</p>
  </header>
  {!ownerAuthorized ? (
   <div className="bridge-review-notice" role="alert">
    <strong>Zugriff gesperrt</strong>
    <p>Für diesen Bereich ist die verifizierte und eindeutig konfigurierte VITO-Owner-Identität erforderlich. Ohne gültige Owner-Zuordnung werden keine Vorgänge angezeigt.</p>
   </div>
  ) : (
   <>
    <div className="bridge-review-notice" role="status">
     <strong>Integration vorbereitet · Datenquelle nicht verbunden</strong>
     <p>Die BRIDGE-Handoff-Verträge und Rollenregeln sind privat getestet. Eine autorisierte, revisionssichere Queue-Datenquelle ist hier noch nicht angeschlossen. Keine echten Vorgänge oder Freigaben werden angezeigt.</p>
    </div>
    <div className="bridge-review-stats" aria-label="Verbindungsstatus">
     <article><span>Datenquelle</span><strong>Gesperrt</strong></article>
     <article><span>Prüfaufträge</span><strong>Unbekannt</strong></article>
     <article><span>Entscheidungen</span><strong>Deaktiviert</strong></article>
    </div>
    <section className="bridge-review-panel" aria-labelledby="bridge-review-inbox-title">
     <h2 id="bridge-review-inbox-title">Eingang für Prüfaufträge</h2>
     <p>Keine Datenquelle verbunden. „Unbekannt“ bedeutet nicht null offene Aufträge.</p>
     <p>Bei der späteren Anbindung werden ausschließlich serverseitig geprüfte Vorgangsmetadaten (Partnerreferenz, Leadreferenz, Status, erwartete Version und Review-Gate) sichtbar. Keine Kundenkontakte oder Notizen.</p>
    </section>
    <section className="bridge-review-panel" aria-labelledby="bridge-review-gates-title">
     <h2 id="bridge-review-gates-title">Aktivierungsgates</h2>
     <ul>
      <li>Gemeinsame Identitätsbasis mit getrennter BRIDGE- und VITO-Berechtigung</li>
      <li>Genehmigtes Partnerregister und mandantenfestes Datenbankmodell</li>
      <li>Atomare Vorgangsannahme, Idempotenz, Versionierung und Audit</li>
      <li>Freigegebene Lead-/Recruiting-Datenschutzprozesse</li>
      <li>Separat autorisierte, nachweisbare Backoffice-Entscheidungen</li>
      <li>Owner-/Security-/Legal-Abnahme vor jeglicher Produktivschaltung</li>
     </ul>
    </section>
   </>
  )}
 </section>;
}
