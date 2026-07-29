# VITO Digital Workforce Platform – API

Backend für die VITO Digital Workforce Platform. VITO verwaltet
Organisationen, menschliche Benutzer, digitale Mitarbeiter (Digital
Employees), Fähigkeiten (Capabilities), Aufgaben (Tasks) und
Audit-Ereignisse. VITO ist **kein CRM und kein ERP**; externe Systeme
(ERPNext, Odoo, Gmail, Calendar, GitHub) werden erst später über Adapter
angebunden.

> ## ⚠️ Security Warning: aktueller Stand der Authentifizierung
>
> Seit Sprint 2 ist **JWT-basierte Authentifizierung die produktive
> Sicherheitsgrenze** (siehe `docs/adr/003-jwt-tenant-context-and-mvp-authorization.md`,
> im Folgenden ADR-003). Der früher ungeprüfte Header `X-Organization-Id`
> ist **kein** Ersatz für ein Login mehr:
>
> - Standardmäßig wird er von der API überhaupt nicht mehr ausgewertet.
> - Er funktioniert **nur**, wenn explizit
>   `ALLOW_INSECURE_TENANT_HEADER=true` gesetzt ist (Standard: `false`),
>   und **auch dann nur**, wenn gar kein `Authorization`-Header im Request
>   vorhanden ist — ein gültiges JWT kann durch diesen Header niemals
>   überschrieben werden.
> - Dieser Fallback liefert weder `userId` noch `role`; jeder Endpunkt mit
>   `@Roles(...)`-Beschränkung lehnt ihn automatisch ab. Er eignet sich
>   ausschließlich für rollenlose, rein lesende lokale Entwicklung.
> - **Die Anwendung startet nicht**, wenn `ALLOW_INSECURE_TENANT_HEADER=true`
>   zusammen mit `NODE_ENV=production` gesetzt ist (siehe `main.ts`).
> - **Bevor irgendein Adapter zu Gmail, Google Calendar, einem CRM/ERP oder
>   einem anderen sensiblen externen System angebunden wird**, sind die in
>   ADR-003 dokumentierten verbleibenden Risiken (siehe dort) zu bewerten
>   und ggf. zu schließen — das gilt weiterhin uneingeschränkt.
>
> Siehe auch `docs/adr/001-modular-monolith-tenant-audit.md` (Grundsatz-ADR)
> und ADR-003 (Details zu Token-Claims, Rollenmodell, Trust Boundary,
> Token-Invalidierung und verbleibenden Risiken).

## Voraussetzungen

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker + Docker Compose (für PostgreSQL)

## Installation

```bash
pnpm install
```

## Environment-Variablen

Kopiere `.env.example` nach `.env` und passe sie bei Bedarf an:

```bash
cp .env.example .env
```

| Variable                        | Beschreibung                                                                 | Beispiel / Default                                    |
|----------------------------------|-------------------------------------------------------------------------------|--------------------------------------------------------|
| `DATABASE_URL`                  | PostgreSQL-Verbindungsstring                                                   | `postgresql://vito:vito@localhost:5432/vito`            |
| `PORT`                          | HTTP-Port der API                                                              | `3000`                                                  |
| `JWT_SECRET`                    | **Pflicht.** Signaturschlüssel für JWTs. Anwendung startet ohne diesen Wert nicht. | `openssl rand -base64 48`                               |
| `JWT_EXPIRES_IN`                | Gültigkeitsdauer ausgestellter JWTs                                            | Default seit Sprint 2.1: `15m`                          |
| `ALLOW_INSECURE_TENANT_HEADER`  | Nur lokale Entwicklung: aktiviert den `X-Organization-Id`-Fallback ohne Token  | Default: `false`                                        |
| `NODE_ENV`                      | Umgebung; steuert u. a. Swagger-, CORS- und Insecure-Header-Gating             | `development` / `production`                             |
| `ENABLE_SWAGGER`                | Swagger explizit erzwingen, auch wenn `NODE_ENV=production`                    | Default: unset (Swagger aktiv außer in production)       |
| `CORS_ALLOWED_ORIGINS`          | Nur relevant in Produktion: kommagetrennte Liste erlaubter CORS-Origins. Niemals `*`. | Default: leer → CORS in Produktion vollständig blockiert |
| `LOGIN_RATE_LIMIT_MAX`          | Max. Login-Versuche pro IP im Zeitfenster (nur `POST /auth/login`)            | Default: `5`                                            |
| `LOGIN_RATE_LIMIT_WINDOW_MS`    | Zeitfenster für das Login-Rate-Limit in Millisekunden                          | Default: `60000` (1 Minute)                              |
| `SEED_OWNER_EMAIL`              | E-Mail des initialen Owner-Users für ATERIMA (nur für `pnpm prisma:seed`)      | `owner@aterima.io`                                       |
| `SEED_OWNER_PASSWORD`           | Passwort des initialen Owner-Users (≥ 12 Zeichen, sonst wird er nicht angelegt)| —                                                        |

## Start mit Docker Compose (PostgreSQL)

```bash
docker compose up -d postgres
```

## Prisma Migration

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

Für produktive/CI-Umgebungen ohne interaktive Migration:

```bash
pnpm prisma:migrate:deploy
```

`pnpm prisma:migrate:deploy` wendet automatisch **alle** Migrationen aus
`prisma/migrations/` in der Reihenfolge ihrer Zeitstempel an, inklusive:

1. `20260725120000_init` — vollständiges initiales Schema (alle Tabellen,
   Enums, Indizes, Foreign Keys gemäß `prisma/schema.prisma`).
2. `20260725120100_task_assignment_xor_check` — PostgreSQL-CHECK-Constraint,
   der die Task-Assignment-Invariante ("nie gleichzeitig `assignedUserId`
   UND `assignedDigitalEmployeeId`") hart auf Datenbankebene absichert
   (siehe ADR-002).
3. `20260726090000_add_user_auth_fields` — fügt `passwordHash` (nullable)
   und `lastLoginAt` (nullable) zu `users` hinzu (Sprint 2, siehe ADR-003).
4. `20260726150000_add_user_token_version` — fügt `tokenVersion` zu
   `users` hinzu (Sprint 2.1, siehe ADR-003).
5. `20260727100000_add_user_status_disabled` — erweitert `UserStatus`
   um `DISABLED` (Sprint 3A, siehe ADR-004).
6. `20260727100100_add_user_soft_delete_fields` — fügt `deletedAt` und
   `deletedByUserId` (echte Self-Relation `deletedByUser`) zu `users`
   hinzu (Sprint 3A, siehe ADR-004).

Kein manueller Zusatzschritt nötig.

## Seed (optional)

Legt die Organization **ATERIMA** (`slug: aterima`), den DigitalEmployee
**TIMO** (`code: timo`, `employeeType: ORCHESTRATOR`), die Capabilities
`lead.read`, `lead.evaluate`, `task.create`, `email.prepare` sowie einen
initialen **Owner-User** an:

```bash
export SEED_OWNER_EMAIL=owner@aterima.io
export SEED_OWNER_PASSWORD="ein-wirklich-starkes-passwort"
pnpm prisma:seed
```

`SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD` stehen **nicht** hart im Code.
Fehlen sie (oder ist das Passwort kürzer als 12 Zeichen), überspringt der
Seed das Anlegen des Owners mit einer deutlichen Warnung — das übrige Seed
läuft trotzdem durch, damit CI-Läufe ohne Login-Bedarf nicht blockieren.

## Start der API

```bash
pnpm start:dev
```

Die API läuft danach unter `http://localhost:3000`.
Swagger/OpenAPI ist erreichbar unter `http://localhost:3000/api/docs`
(sofern aktiv, siehe `ENABLE_SWAGGER`/`NODE_ENV` oben). In Swagger kann
über den Button **Authorize** ein per `POST /auth/login` erhaltenes JWT
als Bearer-Token hinterlegt werden.

## Tests

```bash
# Unit-Tests
pnpm test

# Integrationstests (End-to-End, benötigen eine erreichbare PostgreSQL-Instanz
# gemäß DATABASE_URL, z. B. via `docker compose up -d postgres`, sowie
# JWT_SECRET, siehe .env.example)
pnpm test:e2e
```

## Authentifizierung

```
POST /auth/login
{
  "email": "owner@aterima.io",
  "password": "...",
  "organizationSlug": "aterima"
}
```

Antwort bei Erfolg:

```json
{
  "accessToken": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": "15m",
  "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "...", "role": "OWNER", "organizationId": "..." }
}
```

`POST /auth/login` ist zusätzlich rate-limitiert (Default: 5 Versuche pro
Minute pro IP, siehe `LOGIN_RATE_LIMIT_MAX`/`LOGIN_RATE_LIMIT_WINDOW_MS`);
bei Überschreitung antwortet die API mit `429 Too Many Requests`. Alle
anderen Endpunkte sind bewusst **nicht** gedrosselt.

Bei falschem Passwort, falschem `organizationSlug`, einem `SUSPENDED`
User oder einer `SUSPENDED`/`ARCHIVED` Organization antwortet der Login
**immer** mit derselben generischen `401`-Meldung
(`"Ungültige Zugangsdaten."`) — es wird nicht verraten, welcher der
Gründe konkret zutrifft.

Alle weiteren Endpunkte außer `GET /health` und `POST /auth/login`
erfordern den Header:

```
Authorization: Bearer <accessToken>
```

`organizationId`, `userId` und `role` werden für den restlichen Request
ausschließlich aus dem verifizierten Token abgeleitet (siehe ADR-003) —
niemals aus einem client-gesteuerten Header.

## Autorisierung (Rollenmodell)

| Aktion                                             | OWNER | ADMIN | MEMBER | VIEWER |
|-----------------------------------------------------|:-----:|:-----:|:------:|:------:|
| Tasks lesen                                          | ✅    | ✅    | ✅     | ✅     |
| Tasks erstellen/bearbeiten/abschließen               | ✅    | ✅    | ✅     | ❌     |
| DigitalEmployees/Capabilities lesen                  | ✅    | ✅    | ✅     | ✅     |
| DigitalEmployees/Capabilities anlegen/ändern/grant/revoke | ✅ | ✅  | ❌     | ❌     |
| Users anlegen (`POST /users`, bis Sprint-3B-Cutover)  | ✅    | ✅    | ❌     | ❌     |
| Users lesen (`GET /users`, `GET /users/:id`)          | ✅    | ✅    | ✅     | ✅     |
| Users bearbeiten (`PATCH /users/:id`)                 | ✅    | ✅*   | ❌     | ❌     |
| Users deaktivieren (`DELETE /users/:id`, Soft Delete) | ✅    | ✅    | ❌     | ❌     |
| Eigenes Passwort ändern (`PATCH /users/me/password`)  | ✅    | ✅    | ✅     | ✅     |
| AuditEvents lesen                                    | ✅    | ✅    | ❌     | ❌     |

*ADMIN darf bei `PATCH /users/:id` keine `OWNER`-Rolle vergeben oder
entziehen — nur ein `OWNER` darf das (Privilege-Escalation-Schutz, siehe
ADR-004).

Keine komplexe Permission Engine — Durchsetzung über den einfachen
`@Roles(...)`-Decorator + `RolesGuard` (siehe ADR-003). Ein User kann
grundsätzlich niemals auf Daten einer anderen Organization zugreifen, da
`organizationId` ausschließlich aus dem eigenen JWT stammt.

## User Administration (Sprint 3A)

```
GET    /users?take=&skip=&status=&role=&includeDisabled=
GET    /users/:id
PATCH  /users/:id      { firstName?, lastName?, role?, status? }
DELETE /users/:id
PATCH  /users/me/password   { currentPassword, newPassword }
```

- **Pagination:** `take`/`skip` (Offset-Pagination), `take` maximal `100`
  (Standard `20`); höhere Werte liefern `400`.
- **Filter:** `status`, `role`. Ohne `status`-Filter blendet `GET /users`
  `DISABLED`-User standardmäßig aus; `includeDisabled=true` zeigt sie
  zusätzlich.
- **Nie `passwordHash` in der Antwort** — auf keinem der obigen
  Endpunkte, auch nicht bei `POST /users`.
- **`PATCH /users/:id`** akzeptiert `status` in Sprint 3A ausschließlich
  mit den Werten `ACTIVE`/`SUSPENDED` (`DISABLED` wird ausschließlich
  über `DELETE /users/:id` gesetzt; `LOCKED` existiert erst ab
  Sprint 3B). Ein Rollenwechsel oder eine Suspendierung erhöht
  `tokenVersion` — bereits ausgestellte Tokens dieses Users werden damit
  sofort entwertet (Wiederverwendung des Sprint-2.1-Mechanismus).
- **`DELETE /users/:id`** ist ein **Soft Delete**: `status = DISABLED`,
  `deletedAt` und `deletedByUserId` (echte Relation auf den
  deaktivierenden User) werden gesetzt, `tokenVersion` erhöht — es gibt
  kein physisches `SQL DELETE`. Selbst-Deaktivierung ist nicht möglich.
- **Letzter-OWNER-Schutz:** Ein Rollenwechsel/eine Suspendierung/eine
  Deaktivierung, die den letzten verbleibenden aktiven `OWNER` einer
  Organizationträfe, wird mit `409 Conflict` abgelehnt. Die Prüfung
  läuft transaktional mit einem `SELECT ... FOR UPDATE`-Lock auf die
  `Organization`-Zeile (siehe ADR-004) — nicht nur als
  Anwendungslogik-Check außerhalb einer Transaktion.
- **`PATCH /users/me/password`** prüft das aktuelle Passwort, erhöht
  `tokenVersion` und liefert direkt ein neues, gültiges JWT in der
  Antwort — das zuvor genutzte Token wird durch dieselbe
  `tokenVersion`-Erhöhung entwertet.
- **E-Mail-Normalisierung:** Alle E-Mail-Adressen werden vor Lookup/
  Speicherung zentral über `normalizeEmail()` (trim + lowercase)
  normalisiert — Login, `POST /users`, und (ab Sprint 3B) Invitations
  nutzen dieselbe Funktion.

Details, Transaktionsgrenzen und Testszenarien:
`docs/design/sprint-3-user-management-design.md` und ADR-004.

## Mandantentrennung

Zugriff auf einen Datensatz einer anderen Organization liefert
`404 Not Found` (keine Unterscheidung zwischen "existiert nicht" und
"gehört jemand anderem").

`GET /organizations/:id` ist auf die eigene Organization beschränkt
(Vergleich gegen `organizationId` aus dem JWT); Anfragen zu fremden IDs
liefern ebenfalls `404`.

**Seit Sprint 2.1 gibt es keinen `POST /organizations`-Endpunkt mehr**
(siehe ADR-001, Abschnitt "Deaktivierung von POST /organizations", und
ADR-003). Ein Aufruf liefert die Standard-404-Antwort für unbekannte
Routen. Neue Organizations entstehen ausschließlich über:

- den Seed-Prozess (`pnpm prisma:seed`),
- einen Bootstrap-/Ops-Prozess (direkter Datenbankzugriff),
- ein zukünftiges, noch nicht existierendes Platform-Admin-Modul.

## Beispiel-Requests

### Login

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@aterima.io", "password": "ein-wirklich-starkes-passwort", "organizationSlug": "aterima"}' \
  | jq -r .accessToken)
```

### DigitalEmployee (TIMO) anlegen

```bash
curl -X POST http://localhost:3000/digital-employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
        "name": "TIMO",
        "code": "timo",
        "employeeType": "ORCHESTRATOR",
        "version": "0.1.0"
      }'
```

### Capability anlegen und TIMO zuweisen

```bash
CAP_ID=$(curl -s -X POST http://localhost:3000/capabilities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"code": "lead.read", "name": "Lead lesen"}' | jq -r .id)

TIMO_ID="<id aus der DigitalEmployee-Antwort>"

curl -X POST "http://localhost:3000/digital-employees/$TIMO_ID/capabilities/$CAP_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

### Task anlegen und TIMO zuweisen

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"title\": \"Lead prüfen\", \"assignedDigitalEmployeeId\": \"$TIMO_ID\"}"
```

### Task abschließen

```bash
TASK_ID="<id aus der Task-Antwort>"

curl -X POST "http://localhost:3000/tasks/$TASK_ID/complete" \
  -H "Authorization: Bearer $TOKEN"
```

### User Administration (Sprint 3A)

```bash
# Paginierte Liste, DISABLED ausgeblendet
curl "http://localhost:3000/users?take=20&skip=0" -H "Authorization: Bearer $TOKEN"

# Rolle ändern (OWNER/ADMIN)
curl -X PATCH "http://localhost:3000/users/$USER_ID" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"role": "ADMIN"}'

# Soft Delete
curl -X DELETE "http://localhost:3000/users/$USER_ID" -H "Authorization: Bearer $TOKEN"

# Eigenes Passwort ändern
curl -X PATCH "http://localhost:3000/users/me/password" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"currentPassword": "...", "newPassword": "ein-neues-starkes-passwort"}'
```

### Audit-Events abrufen (nur OWNER/ADMIN)

```bash
curl http://localhost:3000/audit-events -H "Authorization: Bearer $TOKEN"
```

## Bekannte Einschränkungen

- Kein Refresh-Token-Flow, kein Logout/Blacklisting-Endpunkt.
  Token-Invalidierung erfolgt durch drei Mechanismen in Kombination: kurze
  Laufzeit (`JWT_EXPIRES_IN`, Default `15m`), die Per-Request-Prüfung in
  `JwtStrategy.validate()` (User/Org müssen `ACTIVE` bleiben) und
  `User.tokenVersion` (Sprint 2.1) — ein Erhöhen von `tokenVersion`
  entwertet gezielt alle zuvor für diesen User ausgestellten Tokens, ohne
  eine Blacklist pflegen zu müssen. Ein noch nicht abgelaufenes,
  gestohlenes Token bleibt aber bis zum Ablauf gültig, solange
  `tokenVersion` nicht erhöht wird — siehe ADR-003 "Warum keine Refresh
  Tokens".
- Keine Self-Service-Registrierung und kein "Invite annehmen"-Flow (kommt
  mit Sprint 3B); über `POST /users` angelegte User erhalten kein
  Passwort und können bis dahin nicht einloggen.
- Kein Passwort-Reset (kommt mit Sprint 3B).
- Kein automatischer Account-Lockout nach Fehlversuchen (`LOCKED`-Status,
  kommt mit Sprint 3B, siehe `docs/design/sprint-3-user-management-design.md`).
- Keine komplexe Permission Engine; Rollenmodell ist bewusst grob
  (4 Rollen, siehe Tabelle oben).
- **Seit Sprint 2.1 gibt es keinen `POST /organizations`-Endpunkt mehr**
  (siehe oben und ADR-001); neue Organizations entstehen ausschließlich
  über Seed/Bootstrap/ein künftiges Platform-Admin-Modul.
- **`POST /users` bleibt bis zum Sprint-3B-Cutover bestehen** und wird
  dann durch den Invitation-Flow ersetzt (siehe ADR-004).
- Die Regel "Task gehört genau einem User, einem DigitalEmployee oder
  niemandem" wird auf zwei Ebenen durchgesetzt: Anwendungslogik
  (`TasksService.resolveAssignmentTarget`) und zusätzlich ein
  PostgreSQL-CHECK-Constraint (siehe ADR-002).
- Pagination existiert seit Sprint 3A nur für `GET /users`; andere
  List-Endpunkte (`GET /tasks`, `GET /digital-employees`, ...) haben
  weiterhin keine.
- Soft Delete existiert seit Sprint 3A für `User`
  (`DELETE /users/:id`) sowie weiterhin für DigitalEmployeeCapability
  (Revoke); andere Entitäten kennen weiterhin kein Soft Delete.
- Rate-Limiting gilt ausschließlich für `POST /auth/login`; es gibt
  bewusst keine globale API-Drosselung (siehe ADR-003).
- Alle sechs Migrationen (`20260725120000_init`,
  `20260725120100_task_assignment_xor_check`,
  `20260726090000_add_user_auth_fields`,
  `20260726150000_add_user_token_version`,
  `20260727100000_add_user_status_disabled`,
  `20260727100100_add_user_soft_delete_fields`) wurden deterministisch aus
  `prisma/schema.prisma` erzeugt und real gegen eine lokale PostgreSQL-16-
  Instanz angewendet und funktional getestet, jedoch **nicht** über die
  `prisma migrate`-CLI selbst erzeugt, da der Download der
  Prisma-Query-/Schema-Engine in der Entwicklungs-Sandbox blockiert war.
  Bitte in einer Umgebung mit Zugriff auf `binaries.prisma.sh` einmalig
  mit `prisma migrate status` gegenprüfen.
- Aus demselben Grund konnten `prisma generate`, `pnpm prisma:seed` und
  die E2E-Tests in der Entwicklungs-Sandbox nicht real ausgeführt werden.
  Bitte lokal mit Netzwerkzugriff verifizieren.

## Empfehlungen für den nächsten Sprint

1. **Sprint 3B — Identity Lifecycle:** Invitation-Flow (ersetzt
   `POST /users`), Password Reset, automatischer Account-Lockout
   (`LOCKED`), Dev-Token-Gating (`ALLOW_DEV_AUTH_TOKENS`) — vollständig
   spezifiziert in `docs/design/sprint-3-user-management-design.md`.
2. Platform-Admin-Rolle bzw. dedizierter Bootstrap-Prozess für die
   Organization-Erstellung (aktuell bewusst ganz ohne API-Endpunkt, siehe
   oben).
3. Refresh-Token-Strategie, sobald die aktuelle Kombination aus kurzer
   Token-Laufzeit + Per-Request-DB-Check + `tokenVersion` nicht mehr
   ausreicht (siehe ADR-003 "Warum keine Refresh Tokens").
4. Pagination und Filterung für die übrigen List-Endpunkte (`GET /tasks`,
   `GET /digital-employees`, ...), analog zu `GET /users` aus Sprint 3A.
5. Einmaliger Abgleich der Migrationshistorie (`prisma migrate status` /
   `prisma migrate resolve`) in einer Umgebung mit Zugriff auf die
   Prisma-Engine-Downloads.
6. Vor Anbindung sensibler externer Connectoren (Gmail, Calendar, CRM,
   ERP, ...): die in ADR-003 aufgeführten verbleibenden Risiken erneut
   bewerten.
