# ADR-001: Modularer Monolith, Tenant-Kontext per Header, zentrales Audit

## Status
Akzeptiert (Entscheidung 2 seit Sprint 2 durch ADR-003 abgelöst — siehe unten)

## Kontext
VITO benötigt eine Grundarchitektur für die erste Ausbaustufe der Digital
Workforce Platform. Externe Systeme (ERPNext, Odoo, Gmail, Calendar, GitHub)
werden erst später über Adapter angebunden. Es soll kein CRM/ERP-Datenmodell
entstehen.

## Entscheidungen

1. **Modularer NestJS-Monolith statt Microservices.** Der Funktionsumfang
   ist im aktuellen Sprint klein genug, dass Microservices unnötige
   Komplexität (Netzwerk, Deployment, Datenkonsistenz) einführen würden.
   Jede fachliche Domäne (Organizations, Users, DigitalEmployees,
   Capabilities, Tasks, Audit) ist als eigenständiges NestJS-Modul
   gekapselt, um einen späteren Schnitt in Services zu erleichtern.

2. **Mandantentrennung über `X-Organization-Id`-Header (Sprint 1, seit
   Sprint 2 durch ADR-003 abgelöst).** Ursprünglich wurde ein
   request-scoped `TenantContext`-Provider über eine Middleware aus dem
   Header befüllt. Alle Services filterten zusätzlich zu Prisma-`where`-
   Klauseln nach `organizationId`. Das entkoppelte die Tenant-Ermittlung
   bewusst von der eigentlichen Business-Logik, damit die spätere
   Umstellung auf echte Authentifizierung ohne Service-Änderungen möglich
   ist. **Diese Umstellung ist seit Sprint 2 erfolgt** — siehe ADR-003
   für die aktuelle, JWT-basierte Implementierung. Der Header existiert
   weiterhin, aber nur noch als eng begrenzter, produktionssicher
   deaktivierter Development-Fallback.

3. **Fremdzugriffe liefern 404, nicht 403.** Um keine Information über die
   Existenz fremder Datensätze zu leaken, antwortet die API bei Zugriff auf
   eine Ressource einer anderen Organization mit `404 Not Found` statt
   `403 Forbidden`.

4. **Zentraler `AuditService`.** Alle audit-relevanten Aktionen erzeugen
   AuditEvents ausschließlich über einen einzigen, injizierbaren Service.
   Das verhindert inkonsistente oder vergessene Audit-Einträge und macht
   Audit-Regeln zentral wartbar. AuditEvents werden nicht über generische
   CRUD-Endpunkte exponiert, sondern nur lesend über
   `GET /audit-events`.

5. **Keine ERP-/CRM-Datenmodelle.** Capabilities wie `lead.read` oder
   `email.prepare` sind reine Plattformobjekte ohne fachliche
   Lead-Entität. Das hält die Domäne unabhängig von zukünftigen Adaptern.

## Konsequenzen
- Spätere Einführung von echten Adaptern (ERPNext, Odoo, Gmail, GitHub)
  kann als zusätzliche Module erfolgen, ohne das Domänenmodell zu ändern.
- Migration zu JWT-basierter Authentifizierung erfordert nur einen
  Austausch der Middleware/TenantContext-Befüllung. **Umgesetzt in
  Sprint 2, siehe ADR-003.**
- Eine spätere Aufteilung in Microservices ist durch die Modulgrenzen
  vorbereitet, aber bewusst noch nicht umgesetzt.

## ⚠️ Security Warning: historischer Kontext (Sprint 1) — siehe ADR-003 für den aktuellen Stand

Der folgende Abschnitt beschreibt den Zustand **vor** Sprint 2 und wird
aus Nachvollziehbarkeit unverändert belassen. Für die aktuelle,
produktive Sicherheitsgrenze (JWT-basiert) siehe
`docs/adr/003-jwt-tenant-context-and-mvp-authorization.md`.

Der Header-basierte Tenant-Kontext war **explizit ein
Development-/Prototype-Mechanismus** und **keine Authentifizierung**:

- Er bewies keine Identität und keine Berechtigung. Jeder Aufrufer, der
  eine syntaktisch gültige UUID im Header `X-Organization-Id` mitschickte,
  agierte vollständig als diese Organization — lesend wie schreibend.
- Es gab keine Prüfung, ob der tatsächliche Aufrufer (Mensch, System,
  externer Client) berechtigt war, sich als diese Organization
  auszugeben.
- Diese Einschränkung galt für **alle** Endpunkte gleichermaßen, auch für
  solche, die künftig sensible Aktionen auslösen (z. B. E-Mail-Versand,
  Kalenderänderungen, CRM-Schreibzugriffe über Adapter).

**Konsequenz für die Roadmap (weiterhin gültig):** Vor Anbindung an
Gmail, Google Calendar, ein CRM/ERP oder andere sensible externe Systeme
sind die in ADR-003 dokumentierten verbleibenden Risiken zu bewerten —
die reine Einführung von JWTs allein ist noch keine Freigabe für solche
Anbindungen.

**Der in Sprint 1 als "verpflichtender nächster Schritt" beschriebene
`AuthModule`-Umbau ist mit Sprint 2 umgesetzt** (siehe ADR-003).

## Ergänzung (Sprint 2.1): Deaktivierung von POST /organizations

**Status:** Akzeptiert, ergänzt Entscheidung 3 (Fremdzugriffe liefern 404).

**Kontext:** Bis Sprint 2 war `POST /organizations` hinter `JwtAuthGuard`
erreichbar (Authentifizierung nötig, aber keine Rollenbeschränkung —
siehe Sprint-2-Fassung dieses Dokuments). Das bedeutete: jeder
authentifizierte User einer beliebigen Organization konnte eine weitere,
fremde Organization anlegen. Es gibt in diesem MVP keine
Platform-Admin-Rolle, die diese Aktion fachlich sauber begrenzen würde.

**Entscheidung:** `POST /organizations` wird vollständig aus
`OrganizationsController` entfernt (nicht nur deaktiviert/versteckt). Ein
Aufruf liefert die Standard-Nest-404-Antwort für unbekannte Routen — ohne
Sonderbehandlung, ohne Custom-Fehlermeldung, die verraten würde, dass es
sich um einen bewusst entfernten statt nie existierenden Endpunkt
handelt. `OrganizationsService.create()` wurde ebenfalls entfernt, um
keinen toten, aber aufrufbaren Code-Pfad zu hinterlassen.

Neue Organizations entstehen ausschließlich über:

1. den Seed-Prozess (`pnpm prisma:seed`, direkter Prisma-Zugriff),
2. einen manuellen Bootstrap-/Ops-Prozess (direkter DB-Zugriff),
3. ein zukünftiges, noch nicht existierendes Platform-Admin-Modul mit
   einer dedizierten, eng begrenzten Rolle.

**Begründung (vollständige Rollen-/Risikoabwägung siehe ADR-003):**
Organization-Erstellung ist eine besonders sicherheitskritische Aktion
(neue Mandantengrenze), für die "irgendein eingeloggter User" keine
angemessene Berechtigungsstufe ist. Statt eine Rollenprüfung zu erfinden,
die im aktuellen 4-Rollen-Modell (`OWNER`/`ADMIN`/`MEMBER`/`VIEWER`, alle
organisationsgebunden) ohnehin nicht sauber abbildbar ist, wird der
Endpunkt bis zu einem echten Platform-Admin-Konzept vollständig entfernt.

**Konsequenzen:**
- Self-Service-Tenant-Onboarding ist in diesem MVP nicht möglich — bekannt
  und akzeptiert (siehe README "Bekannte Einschränkungen").
- `CreateOrganizationDto` wurde mit entfernt, da sie ausschließlich vom
  entfernten Endpunkt genutzt wurde.
- Swagger listet `POST /organizations` nicht mehr auf.
