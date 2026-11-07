# VITO · BRIDGE interner Prüfkorb R1 · Owner-only Private Candidate

**Datum:** 07.11.2026 · **Status:** `PRIVATE_SOURCE_PASS`, `READ_ONLY`, `REAL_QUEUE_NOT_CONNECTED`, `OWNER_ONLY`, `NO_DEPLOY`

## Ziel und Basiskandidat

BRIDGE ist das interne Vertrieb-/Geschäftsentwicklungsnetzwerk des LA-VOLPE-Ökosystems; **keine** Plattform zur allgemeinen Partnervermittlung. Der Betreiber will **ein einziges VITO-Cockpit** für interne Entscheidungen, keine zusätzliche Backoffice-Anwendung. Das BRIDGE-Partnerportal (privater PR #324 und Folgebranch) erteilt selbst keine Closing-, Provisionen- oder Teamfreigabe.

Dieser Branch basiert auf VITO-Owner-Gate [Draft PR #175](https://github.com/lavolpeofficial/vito-platform/pull/175). Er fügt nur eine VITO-Control-Center-Seite `/bridge`, einen verifizierbaren Read-model-Vertrag und eine conditional Owner-Navigation hinzu. Bestehende VITO-Sessions, URLs, Bereiche, Sicherheitsflags, Footer und zentrale Rechtsdokumente bleiben unverändert.

## Technische Abgrenzung

- `app/(control-center)/bridge/page.tsx`: Der Bereich ist innerhalb des bestehenden Authenticated-Control-Center-Layouts. Zusätzlich zu `getAuthenticatedSession()` prüft die Seite **immer** `isVitoInteractiveOwner(session)` mit exakt hinterlegter humaner Owner-/Organization-Kennung. Ohne gültiges Pinning gibt sie keine Vorgänge oder Queue-Metadaten aus.
- `components/app-shell.tsx` übergibt eine nur serverseitig ermittelte `showBridgeReview`-Berechtigung. Die vorhandene `ShellNavigation` zeigt BRIDGE nur dann an; ein gewöhnlicher VITO-ADMIN/MEMBER/VIEWER bekommt keine Freigabe oder Daten.
- Der Page-Renderer enthält bewusst keine Kundenkontakte, keine Queue-Fakezahlen, keine Buttons zum Genehmigen oder Ablehnen und **keine Verbindung** zu einer echten oder synthetischen Datenbank. Er meldet `Datenquelle nicht verbunden` und `Unbekannt`, nicht `0 offene Fälle`.
- `lib/bridge-review/contracts.ts`: begrenzter Read-model-Parser für einen **zukünftigen**, serverseitig autorisierten BRIDGE-Queue-Adapter. 100 Datensätze maximal, vollständige Allowlist von Referenzen/Status/Version/Review-Gate, UUID-Vorgänge eindeutig, keine Kundennamen/E-Mail/Tel/Freitextnotizen. Parse-Fehler → `null`; keine Route lädt aktuell Snapshot-Daten.

**Das ist eine Cockpit-Vorbereitung, keine echte fertige Queue.** Eine leere Liste wäre irreführend, solange die BRIDGE-Datenquelle nicht angebunden ist. Es wurden keine Integration-Secrets erzeugt und keine produktiven Identitäts- oder Datenquellen angezapft.

## Warum VITO-Owner-JWT kein BRIDGE-Partnerlogin ist

Die VITO-Owner-Session ist für das interne Kontrollsystem bestimmt. Die BRIDGE-Partneranmeldung benötigt eine getrennte Anwendungsaudience, eigenen Sessionvertrag und ein aktives Partnerregister. Für BRIDGE wurde auf dem privaten Branch ab PR #324 eine eng begrenzte `bridge-central-identity-adapter.mjs`-Schnittstelle angelegt; sie beweist **keine** echte OIDC/JWT-Verifikation und wird erst nach realer IdP-Freigabe angeschlossen. Keine Wiederverwendung eines VITO-Owner-Tokens durch Partner.

## Tatsächliche QA

- HEL1, neuer privater Branch-Clone: **8/8** Node TS-Tests PASS (6 Read-model-Prüfungen, 2 Owner-Gate-/Navigationsquellprüfungen).
- Die Tests decken PII-Reduktion, Enum/Version/UUID-Grenzen, Größenlimit, doppelte Vorgänge, unbekannte Quelle und fehlende Owner-Konfiguration als Code-Grenzen ab.
- `lib/bridge-review/contracts.ts` SHA-256 `9d9d675201d2f6fe551e5a5404d1ef5b9f518a23479b92b08cb576c4ebc2eb6f`.
- Page-Quelle SHA-256 `3c054dbc956a02ae727b9c2f5efc2613e366061c7c5e8b0e31e390926f4298fe`.
- **Nicht geprüft:** Next.js-App-Build/Typecheck, tatsächlicher SSR-/Browser-Aufruf oder Desktop/Mobile-Rendering; die isolierte Checkout-Umgebung hatte kein installiertes Next.js-Dependency-Verzeichnis. Die Source-Tests ersetzen dies ausdrücklich nicht.

## Vor nächster Integration

**Must-have:** autorisierte Real-IdP-Konfiguration (separate BRIDGE-Client-Audience), nachgewiesene Owner-Pins + MFA/Recovery in VITO, genehmigtes Partnerregister; echter dedizierter BRIDGE-Staging-Datenbank-/RLS-/CAS-/Audit-Pfad; verbindlicher interner Queue-Service mit Server-zu-Server-Autorisierung und minimierter Review-Metadatenprojektion; Fachentscheidungen (Scout-Qualifikation, Zuordnung, SLA), Privacy & VITO LEGAL CORE #172; spätere finale Owner-/Security-/Legal-Gates.

**Should-have:** Nach separater Approval echtes read-only Backend und SSR-/Browser-QA. Erst danach menschliche Entscheidungsaktionen mit vollständigem Audit/Version-Check, strikt ohne automatische Endfreigabe.

**Roll-back:** privaten Draft-Branch schließen, keine Deploy-/DB-/DNS-/Auth- oder bestehende Live-Änderung. Der zentrale Footer wird nicht verändert.
