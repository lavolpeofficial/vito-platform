# Sprint 3 — Technical Design: User Management (Revision 3)

**Status:** Sprint 3A (User Administration) freigegeben und in
Umsetzung. Sprint 3B (Identity Lifecycle) weiterhin Entwurf, nicht Teil
dieser Implementierung.
**Vorgänger:** Sprint 1 (Domänenmodell, Mandantentrennung), Sprint 2
(JWT-Auth, RBAC-Grundlage), Sprint 2.1 (Security Hardening), Sprint-3-
Design Revision 1 (initialer Entwurf), Revision 2 (Architektur-Review).

## Änderungsübersicht (Revision 3 — drei redaktionelle Korrekturen vor
Implementierungsstart)

1. **Production-Startup-Check (Kap. 4, „Dev-Token-Gating“):** korrigiert
   einen Copy-and-paste-Fehler. Der Startup-Check verweigert den Start
   in `NODE_ENV=production`, wenn **entweder**
   `ALLOW_INSECURE_TENANT_HEADER=true` **oder unabhängig davon**
   `ALLOW_DEV_AUTH_TOKENS=true` gesetzt ist — zwei getrennte Prüfungen,
   der vorherige Text nannte fälschlich zweimal denselben Variablennamen.
2. **`LOCKED`-Autoentsperrung präzisiert (Kap. 3.2, neues Kap. 9/T4):**
   Bei Login eines `LOCKED`-Users wird zuerst geprüft, ob die Sperrzeit
   abgelaufen ist; falls ja, erfolgt atomar `LOCKED → ACTIVE` +
   Zähler-Reset + Fortsetzung desselben Login-Versuchs. Ausdrücklich
   **nicht Teil von Sprint 3A** — reine Präzisierung für die spätere
   Sprint-3B-Umsetzung.
3. **Race-Test für den letzten OWNER korrigiert (Kap. 10.2):** muss zwei
   **unterschiedliche** verbleibende OWNER betreffen (nicht zweimal
   denselben) — genau ein Request erfolgreich, genau einer `409`, danach
   exakt ein aktiver OWNER. Dieser Test ist jetzt korrekt als
   **Sprint-3A**-Test einsortiert (T1/Letzter-OWNER-Schutz ist eine
   3A-Funktion, war in Revision 2 versehentlich unter 3B gelistet).

## Änderungsübersicht (Revision 2)

Alle 11 Review-Punkte wurden verbindlich eingearbeitet:

| # | Review-Punkt | Wo umgesetzt |
|---|---|---|
| 1 | `LOCKED`/`SUSPENDED`/`DISABLED` fachlich trennen, Organization-Status nicht spiegeln | Kap. 3 (neue explizite Regel + bereinigtes Diagramm), Kap. 1 (Ergänzung) |
| 2 | Partieller Unique Index statt `@@unique` für Invitations | Kap. 2.3, Kap. 8 |
| 3 | E-Mail-Normalisierung (trim + lowercase) | Kap. 2.3, Kap. 8 (defensiver CHECK) |
| 4 | Letzter-OWNER-Schutz transaktional (Isolation/Retry) | Neues Kap. 9 „Transaktionsgrenzen“ (T1) |
| 5 | Invitation Acceptance atomar | Kap. 9 (T2) |
| 6 | Password Reset atomar | Kap. 9 (T3) |
| 7 | Reset nur `LOCKED → ACTIVE`, `SUSPENDED`/`DISABLED` bleiben | Kap. 3, Kap. 4B.6, Kap. 9 (T3) |
| 8 | `ALLOW_DEV_AUTH_TOKENS`, Production verweigert Start | Kap. 4B.5/4B.1, Kap. 11 |
| 9 | Token/Hash nie loggen/auditieren | Kap. 7 (Ergänzung), Kap. 9 |
| 10 | Sprint 3A/3B-Aufteilung | Kap. 4 (komplett neu strukturiert), Kap. 8 |
| 11 | `deletedByUserId` als Relation — Entscheidung | Kap. 6 (Ergänzung) |

Zusätzlich aktualisiert wie beauftragt: Datenmodell, Lifecycle,
API-Design, RBAC, Migrationen, Teststrategie, Risiken,
Decision-Required-Tabelle. Neu hinzugekommen: Kapitel 9
„Transaktionsgrenzen“. Kapitel 1 (Architekturübersicht) und Kapitel 6/7
(Soft Delete/Audit) wurden dort punktuell ergänzt, wo die Review-Punkte
1, 9 und 11 es zwingend erfordern — sonst unverändert.

---

## 1. Architekturübersicht

*(Unverändert gegenüber Revision 1, siehe dortige Beschreibung von
Auth/JWT/TenantContext/Audit/RBAC/Digital-Employees-Zusammenspiel.
Ergänzung durch Review-Punkt 1:)*

**Ergänzung (Review-Punkt 1) — Entkopplung von Organization- und
User-Status:** `TenantContext`/`JwtStrategy.validate()` prüfen bereits
seit Sprint 2 zwei **unabhängige** Bedingungen: `user.status === 'ACTIVE'`
und `organization.status === 'ACTIVE'`. Dieses Design führt **keine**
neue Verknüpfung zwischen beiden ein. Es gibt und wird keinen Codepfad
geben, der bei einer Organisationsstatus-Änderung (`ACTIVE → SUSPENDED`)
automatisch `User.status` verändert, und umgekehrt. Beide
Zustandsautomaten bleiben strukturell getrennt — siehe Kap. 3 für die
explizite Regel.

---

## 2. Datenmodell

### 2.1 Erweiterung von `User`

| Feld | Typ | Phase | Zweck |
|---|---|---|---|
| `deletedAt` | `DateTime?` | 3A | Soft-Delete-Zeitstempel (siehe Kap. 6) |
| `deletedByUserId` | `String?` | 3A | **Echte Relation** zu `User` (siehe Kap. 6, Review-Punkt 11 — Entscheidung final) |
| `failedLoginAttempts` | `Int @default(0)` | 3B | Zähler für `LOCKED`-Automatik (siehe Kap. 3) |
| `lockedAt` | `DateTime?` | 3B | Zeitpunkt der automatischen Sperrung |

`passwordHash`, `lastLoginAt`, `tokenVersion` (Sprint 2/2.1) bleiben
unverändert.

**E-Mail-Normalisierung (Review-Punkt 3):** Alle Schreibpfade, die
`User.email` oder `Invitation.email` setzen (`AuthService.login()`-
Lookup, `InvitationsService.create()`, `InvitationsService.accept()`),
normalisieren die Eingabe **vor** jedem DB-Zugriff über eine zentrale
Hilfsfunktion:

```ts
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
```

Diese Funktion lebt in `common/` (z. B.
`common/utils/normalize-email.ts`), damit sie von `AuthService`,
`UsersService`, `InvitationsService` und der `IsEmail`-DTO-Validierung
(via `@Transform`) gleichermaßen genutzt wird — **eine** Implementierung,
nicht mehrere leicht unterschiedliche Kopien. Zusätzlich zur
Anwendungsebene wird ein defensiver DB-Constraint empfohlen (siehe Kap. 8,
analog zum bereits etablierten Muster aus ADR-002).

### 2.2 Enums

```prisma
enum UserStatus {
  INVITED     // 3A (bereits vorhanden)
  ACTIVE      // 3A (bereits vorhanden)
  SUSPENDED   // 3A (bereits vorhanden) — admin-/organisationsseitig, reversibel
  LOCKED      // 3B (neu) — automatisch, sicherheitsbedingt, selbstheilend
  DISABLED    // 3A (neu) — final, Soft-Delete-Marker
}
```

**Verbindliche Bedeutungstrennung (Review-Punkt 1):**

- `LOCKED`: **ausschließlich** automatisch durch `AuthService.login()`
  gesetzt (Fehlversuchsschwelle erreicht). Niemals durch einen
  Admin-Endpunkt direkt **gesetzt** (Admins können nur manuell
  **entsperren**, siehe Kap. 3/4A.3). Niemals durch Organisationsstatus
  ausgelöst.
- `SUSPENDED`: **ausschließlich** durch eine explizite Admin-Aktion
  (`PATCH /users/:id`) gesetzt/entfernt. Kein automatischer Auslöser.
  **Kein Zusammenhang mit `Organization.status`** — eine Organisation
  kann `SUSPENDED` sein, während einzelne User weiterhin `ACTIVE` sind
  (deren Login wird dann durch die separate Organisationsprüfung in
  `JwtStrategy.validate()` verhindert, nicht durch eine Statusänderung
  am User).
- `DISABLED`: **ausschließlich** durch `DELETE /users/:id`
  (Soft Delete) gesetzt, final (siehe Kap. 6).

```prisma
enum InvitationStatus {   // 3B
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
}
```

### 2.3 Neue Tabelle: `Invitation` (Phase 3B)

```prisma
model Invitation {
  id              String           @id @default(uuid())
  organizationId  String
  email           String           // normalisiert (trim+lowercase) vor dem Schreiben
  role            UserRole
  status          InvitationStatus @default(PENDING)
  tokenHash       String           @unique
  invitedByUserId String
  expiresAt       DateTime
  acceptedAt      DateTime?
  revokedAt       DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt

  organization  Organization @relation(fields: [organizationId], references: [id])
  invitedByUser User         @relation(fields: [invitedByUserId], references: [id])

  @@index([organizationId, email])
  @@map("invitations")
}
```

**Review-Punkt 2 — partieller Unique Index statt `@@unique`:** Die in
Revision 1 vorgeschlagene `@@unique([organizationId, email, status])`
war fachlich falsch (sie hätte z. B. zwei `ACCEPTED`-Zeilen für
dieselbe E-Mail nicht verhindert, aber auch keine echte "nur eine
PENDING"-Garantie geliefert). Die korrekte Regel — **genau eine
`PENDING`-Invitation pro normalisierter E-Mail und Organization,
beliebig viele historische (`ACCEPTED`/`EXPIRED`/`REVOKED`)** — ist ein
**partieller (gefilterter) Unique Index**, den Prismas Schema-DSL (in
der hier verwendeten Version) nicht ausdrücken kann. Prisma bekommt
daher nur den normalen `@@index([organizationId, email])` für
Lookup-Performance; die eigentliche Eindeutigkeitsgarantie kommt aus
einer **händisch nachgezogenen SQL-Migration** (Beschreibung, kein SQL,
siehe Kap. 8) — exakt dasselbe bereits etablierte Muster wie der
`task_assignment_xor_check`-CHECK-Constraint aus Sprint 1
(ADR-002-Präzedenzfall). Die Anwendungslogik in
`InvitationsService.create()` prüft zusätzlich (nicht ausschließlich)
per Query vorab auf eine bestehende `PENDING`-Zeile, um im Regelfall
eine sprechende `409`-Fehlermeldung statt eines rohen DB-Fehlers zu
liefern — der DB-Index ist die harte Garantie, die Anwendungsprüfung ist
UX.

### 2.4 Neue Tabelle: `PasswordResetToken` (Phase 3B)

```prisma
model PasswordResetToken {
  id              String    @id @default(uuid())
  userId          String
  tokenHash       String    @unique
  expiresAt       DateTime
  consumedAt      DateTime?
  requestedFromIp String?
  createdAt       DateTime  @default(now())

  user User @relation(fields: [userId], references: [id])

  @@index([userId])
  @@map("password_reset_tokens")
}
```

Unverändert gegenüber Revision 1. **Review-Punkt 9 (Ergänzung):**
`tokenHash` wird ausschließlich für den serverseitigen Vergleich
gelesen — niemals in `AuditEvent.metadata`, niemals in
Logger-Ausgaben (auch nicht auf `debug`-Level), niemals in
Fehlermeldungen. Siehe Kap. 7 für die vollständige Regel.

### 2.5 Explizit nicht eingeführt

Unverändert gegenüber Revision 1: keine `Session`-/`RefreshToken`-Tabelle,
kein `UserPreferences`, kein separates `UserProfile`.

---

## 3. User Lifecycle

```
                    ┌───────────┐
   Invite akzeptiert │  INVITED   │
   (3B)          ───►│           │
                    └─────┬─────┘
                          │
                          ▼
                    ┌───────────┐
                    │  ACTIVE    │◄───────────────┐
                    └──┬───┬───┬─┘                │
      N Fehlversuche   │   │   │  Admin: SUSPENDED│ Admin reaktiviert (3A)
      (3B, automatisch)│   │   └──────────────────┘  ODER
                        │   │  Admin: DISABLED (3A, final)
              ┌─────────┘   └─────────────┐
              ▼                           ▼
       ┌───────────┐               ┌───────────┐
       │  LOCKED    │               │ SUSPENDED  │
       │  (3B)      │               │  (3A)      │
       └─────┬─────┘               └─────┬─────┘
             │ Timeout ODER                    │
             │ manuelle Entsperrung (3A-Endpunkt,│
             │ 3B-Statuswert)                    │
             ▼                                   │
       ┌───────────┐                             │
       │  ACTIVE    │◄────────────────────────────┘ (Admin reaktiviert, 3A)
       └───────────┘

  Aus JEDEM Zustand außer bereits DISABLED:
       Admin führt DELETE /users/:id aus (3A)
                          │
                          ▼
                    ┌───────────┐
                    │ DISABLED   │  final — kein API-Pfad zurück
                    └───────────┘
```

**Verbindliche Regel (Review-Punkt 1):** `Organization.status` taucht in
diesem Diagramm bewusst **nicht** auf. Es gibt keinen Übergangspfeil, der
von einer Organisationsstatus-Änderung ausgeht. Die Organisationsprüfung
bleibt ein separater, rein lesender Check in `JwtStrategy.validate()`
(unverändert seit Sprint 2).

### 3.1 Zustandstabelle

| Zustand | Bedeutung | Login möglich? | Auslöser | Reversibel? | Phase |
|---|---|---|---|---|---|
| `INVITED` | Eingeladen, kein Passwort gesetzt | Nein | `POST /invitations` | Ja (Invite widerrufbar/verfällt) | 3B |
| `ACTIVE` | Regulär funktionsfähig | Ja | Invite angenommen / Admin reaktiviert / Reset aus `LOCKED` | — | 3A/3B |
| `LOCKED` | Automatisch gesperrt (Fehlversuche) | Nein (bis Entsperrung) | `AuthService.login()`, Schwelle erreicht | Ja — automatische Entsperrung bei Login nach Ablauf der Sperrzeit (siehe Kap. 3.2, **Sprint 3B**), manuelle Entsperrung durch Admin (`PATCH /users/:id`, **Sprint 3B**), oder erfolgreicher Password Reset (Kap. 3.3, **Sprint 3B**) | 3B |
| `SUSPENDED` | Admin-Sperre, per-User, unabhängig von Organization | Nein | `PATCH /users/:id` | Ja — nur durch Admin | 3A |
| `DISABLED` | Endgültig deaktiviert (Soft Delete) | Nein | `DELETE /users/:id` | Nein (kein API-Pfad) | 3A |

### 3.2 Login-Prüfreihenfolge (verbindlich, unverändert zur Empfehlung
aus Revision 1, hier präzisiert; automatische Entsperrung neu in
Revision 3 präzisiert)

`AuthService.login()` prüft in fester Reihenfolge, **bevor** irgendein
Fehlversuchszähler erhöht wird:

1. Organization existiert und `status === 'ACTIVE'`?
2. User existiert (nach `normalizeEmail()`-Lookup)?
3. Ist `user.status === 'LOCKED'`? Falls ja (**Sprint 3B**, siehe
   Präzisierung unten): zunächst prüfen, ob die Sperrzeit abgelaufen
   ist. Falls abgelaufen → **atomar** `LOCKED → ACTIVE` setzen,
   `failedLoginAttempts` auf `0` zurücksetzen, `lockedAt` löschen, und
   **mit demselben Login-Versuch fortfahren** (weiter zu Schritt 4, als
   wäre der User bereits `ACTIVE` gewesen — kein zweiter Request nötig).
   Falls die Sperrzeit **noch nicht** abgelaufen ist → generische `401`,
   kein Zählerinkrement (Zustand bleibt `LOCKED`).
4. Ist `user.status === 'ACTIVE'`? (nach ggf. erfolgter Auto-Entsperrung
   aus Schritt 3, oder von Anfang an) — falls nicht (`SUSPENDED`,
   `DISABLED`, oder `LOCKED` mit noch nicht abgelaufener Sperrzeit):
   generische `401`, kein Zählerinkrement.

Nur wenn Organization **und** User zu diesem Zeitpunkt `ACTIVE` sind,
wird das Passwort verglichen. Jeder Fehlschlag — Organisation fehlt/
suspendiert, User fehlt/`LOCKED` (noch gesperrt)/`SUSPENDED`/`DISABLED`,
oder Passwort falsch — liefert **dieselbe** generische `401`-Antwort
(unverändert seit Sprint 2).

**Präzisierung der automatischen Entsperrung (Sprint 3B, verbindlich für
die spätere Implementierung, in Sprint 3A nicht umgesetzt):** Schritt 3
(Prüfung + ggf. Entsperrung) muss **atomar** erfolgen — ein einzelnes
`UPDATE`, dessen `WHERE`-Klausel die Sperrzeit-Bedingung selbst prüft
(analog zum bereits in Kap. 9, T3 beschriebenen `CASE WHEN`-Muster),
statt eines separaten "erst lesen, dann in der Anwendung entscheiden,
dann schreiben"-Ablaufs, der unter Nebenläufigkeit (zwei zeitgleiche
Login-Versuche desselben Users kurz nach Ablauf der Sperrzeit) zu
inkonsistenten Zwischenzuständen führen könnte. Die konkrete
SQL-/Transaktionsskizze folgt in Kap. 9 als **T4** und wird mit der
Sprint-3B-Implementierung ausgearbeitet.

**Ausdrücklich nicht Teil von Sprint 3A:** Weder der `LOCKED`-Enum-Wert
noch `failedLoginAttempts`/`lockedAt` noch die hier beschriebene
Login-Erweiterung werden in Sprint 3A umgesetzt. `AuthService.login()`
bleibt in Sprint 3A **unverändert** gegenüber Sprint 2.1 — die einzige
3A-relevante Konsequenz ist, dass `DISABLED` (neu) in der bestehenden
Statusprüfung genauso wie das bereits vorhandene `SUSPENDED` behandelt
wird (Zugriff verweigert, generische 401, kein neuer Codepfad).

### 3.3 Password Reset und Statusübergänge (Review-Punkt 7)

`POST /password-resets/:token/consume` darf **ausschließlich**
`LOCKED → ACTIVE` automatisch auslösen. Explizit **nicht** automatisch
verändert werden `SUSPENDED` (bleibt `SUSPENDED`) und `DISABLED` (bleibt
`DISABLED`) — ein erfolgreicher Reset setzt in diesen Fällen zwar das
neue Passwort (für den Fall einer künftigen Reaktivierung durch einen
Admin), ändert aber **nicht** die Zugriffsberechtigung. `INVITED`-User
können keinen Password Reset durchführen (kein bestehendes Passwort,
kein `passwordHash`) — sie müssen den Invitation-Flow nutzen; ein
Reset-Request für eine `INVITED`-E-Mail liefert dieselbe generische
`202`-Antwort wie ein nicht existierender User (Anti-Enumeration), ohne
tatsächlich einen nutzbaren Token zu erzeugen. Siehe Kap. 9 (T3) für die
atomare Umsetzung dieser Regel.

---

## 4. API Design

**Phasenaufteilung (Review-Punkt 10):** Sprint 3A liefert
Administrationsfunktionen auf Basis des bestehenden, unveränderten
Login-Mechanismus (Sprint 2/2.1 bleibt während 3A unangetastet).
Sprint 3B liefert die neuen, token-ausstellenden Self-Service-Flows
(Invitation, Password Reset) sowie die davon abhängige
`LOCKED`-Automatik. `POST /users` (Sprint 2) bleibt während 3A
unverändert bestehen und wird **erst mit Abschluss von 3B** entfernt,
wenn Invitation als vollwertiger Ersatz zur Verfügung steht (kein
Zwischenzustand ohne jeglichen User-Anlage-Weg).

### 4A. Sprint 3A — User Administration

#### 4A.1 Benutzer auflisten
- `GET /users?take=&skip=&status=&role=&includeDisabled=`
- Response: `200`, Array (ohne `passwordHash`), `DISABLED`-User
  standardmäßig ausgeblendet (siehe Kap. 6)
- Berechtigung: alle Rollen (unverändert)

#### 4A.2 Benutzer bearbeiten
- `PATCH /users/:id`
- Request: `firstName?`, `lastName?`, `role?`,
  `status?` (in 3A nur `ACTIVE ⇄ SUSPENDED`; `LOCKED → ACTIVE` kommt als
  zusätzlich erlaubter Wert **mit 3B**, ohne neuen Endpunkt)
- Berechtigung: `OWNER`, `ADMIN`; `ADMIN` darf keine `OWNER`-Rolle
  vergeben/entziehen; Selbst-Downgrade des letzten `OWNER` wird
  transaktional verhindert (siehe Kap. 9, T1)
- Audit: `USER_UPDATED` / `USER_ROLE_CHANGED` / `USER_STATUS_CHANGED`
- Bei Rollenwechsel oder Statuswechsel auf `SUSPENDED`: `tokenVersion`
  wird erhöht

#### 4A.3 Benutzer deaktivieren (Soft Delete)
- `DELETE /users/:id`
- Response: `200`, `{ id, status: "DISABLED", deletedAt, deletedByUserId }`
- Berechtigung: `OWNER`, `ADMIN`; nicht gegen die eigene `:id`; transaktional
  gegen den letzten `OWNER` abgesichert (Kap. 9, T1)
- Audit: `USER_DISABLED`
- `tokenVersion` wird erhöht

#### 4A.4 Eigenes Passwort ändern
- `PATCH /users/me/password`
- Request: `currentPassword`, `newPassword`
- Response: `200`, neues JWT (analog Login-Response, siehe D7)
- Berechtigung: jede Rolle, nur für sich selbst
- Audit: `USER_PASSWORD_CHANGED`
- `tokenVersion` wird erhöht (aktuelles Token wird mit-entwertet, neues
  Token in der Response ersetzt es)

### 4B. Sprint 3B — Identity Lifecycle

#### 4B.1 Einladung erstellen
- `POST /invitations` — Request: `email`, `role`
- E-Mail wird vor Prüfung/Speicherung normalisiert (Kap. 2.1)
- Response: `201`, Invitation-Objekt **ohne** `tokenHash`. Klartext-Token
  wird **ausschließlich** in der Response mitgeliefert, wenn
  `ALLOW_DEV_AUTH_TOKENS=true` gesetzt ist (siehe unten, Review-Punkt 8)
  — niemals sonst, niemals geloggt (Review-Punkt 9)
- Berechtigung: `OWNER`, `ADMIN`; `role: OWNER` nur durch `OWNER` selbst
- Validierung: kein bestehender `ACTIVE`/`INVITED`-User mit dieser
  E-Mail; keine bestehende `PENDING`-Invitation (siehe Kap. 2.3/9, T2)
- Audit: `INVITATION_CREATED` (Metadata: `email`, `role` — **nicht**
  `tokenHash`)

#### 4B.2 Einladung annehmen
- `POST /invitations/:token/accept` — `@Public()`
- Request: `firstName`, `lastName`, `password`
- Response: `200`, gleiche Form wie Login-Response
- Vollständig atomar (Kap. 9, T2): User-Anlage + Invitation-Status +
  Audit in einer Transaktion
- Audit: `USER_CREATED`, `INVITATION_ACCEPTED`

#### 4B.3 Einladung widerrufen
- `DELETE /invitations/:id` — Berechtigung: `OWNER`, `ADMIN`
- Audit: `INVITATION_REVOKED`

#### 4B.4 Einladungen auflisten
- `GET /invitations` — Berechtigung: `OWNER`, `ADMIN`

#### 4B.5 Passwort-Reset anfordern
- `POST /password-resets` — `@Public()`
- Request: `email`, `organizationSlug`
- Response: **immer** `202`, unabhängig von Existenz/Status (Anti-
  Enumeration), außer bei `INVITED` (siehe Kap. 3.3 — ebenfalls `202`,
  aber ohne Token-Erzeugung)
- Response enthält den Klartext-Token **ausschließlich**, wenn
  `ALLOW_DEV_AUTH_TOKENS=true` — siehe „Dev-Token-Gating“ unten
- Audit: `PASSWORD_RESET_REQUESTED` (nur falls User tatsächlich
  existiert und reset-fähig ist — kein Audit-Eintrag sonst, um über
  Audit-Timing keine Enumeration zu ermöglichen)

#### 4B.6 Passwort-Reset einlösen
- `POST /password-resets/:token/consume` — `@Public()`
- Request: `newPassword`
- Response: `200`, neues JWT — **außer** wenn resultierender Status
  `SUSPENDED`/`DISABLED` ist: dann `200` mit Bestätigung, aber **ohne**
  Token (der User kann sich trotz neuem Passwort weiterhin nicht
  einloggen, siehe Kap. 3.3 — ein Token auszustellen wäre hier
  irreführend)
- Vollständig atomar (Kap. 9, T3), Statusregel aus Review-Punkt 7 fest
  im `UPDATE`-Statement kodiert
- Audit: `PASSWORD_RESET_COMPLETED` (Metadata: `userId`, resultierender
  `status` — **nicht** `tokenHash`, **nicht** das neue Passwort)

### Dev-Token-Gating (Review-Punkt 8, gilt für 4B.1 und 4B.5)

Ersetzt die in Revision 1 vage formulierte „nur non-production“-Regel
durch eine explizite, eigenständige Variable:

```
ALLOW_DEV_AUTH_TOKENS=false   # Default
```

- Nur wenn `ALLOW_DEV_AUTH_TOKENS === 'true'`, liefern
  `POST /invitations` und `POST /password-resets` den Klartext-Token in
  der Response.
- **Harter Startup-Check** (Erweiterung der bestehenden
  `assertSecureProductionConfig()`-Funktion aus `main.ts`, kein neuer
  Mechanismus): Die Anwendung verweigert den Start in
  `NODE_ENV=production`, wenn **entweder**
  `ALLOW_INSECURE_TENANT_HEADER=true` **oder unabhängig davon**
  `ALLOW_DEV_AUTH_TOKENS=true` gesetzt ist — zwei getrennte, voneinander
  unabhängige Prüfungen, nicht nur eine. *(Korrektur Revision 3: der
  vorherige Text hier enthielt einen Copy-and-paste-Fehler und nannte
  fälschlich nur `ALLOW_INSECURE_TENANT_HEADER`, obwohl dieser Abschnitt
  von `ALLOW_DEV_AUTH_TOKENS` handelt.)* Beide Flags werden einzeln
  geprüft, damit z. B. `ALLOW_DEV_AUTH_TOKENS=true` allein — auch ohne
  `ALLOW_INSECURE_TENANT_HEADER` — den Start in Production ebenso
  zuverlässig verhindert. Bewusst **kein** neues Konzept, sondern
  Wiederverwendung desselben Patterns aus Sprint 2/2.1 für einen
  zweiten, unabhängigen Dev-only-Schalter.
- Anders als bei `ALLOW_INSECURE_TENANT_HEADER` ist der Default hier
  **auch außerhalb von Production** `false` — ein Entwickler muss ihn
  explizit setzen, er wird nicht automatisch durch
  `NODE_ENV=development` aktiviert. Grund: Token-Ausgabe über die API
  ist ein bewussterer, selteneres Bedürfnis (meist nur für lokale
  End-to-End-Tests) als der Tenant-Header-Fallback.

---

## 5. RBAC — vollständige Berechtigungsmatrix

| Aktion | OWNER | ADMIN | MEMBER | VIEWER | Phase | Begründung |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `GET /users` | ✅ | ✅ | ✅ | ✅ | 3A | Unverändert aus Sprint 2 |
| `PATCH /users/:id` (Name) | ✅ | ✅ | ❌ | ❌ | 3A | Verwaltungsaktion |
| `PATCH /users/:id` (Rolle) | ✅ | ✅* | ❌ | ❌ | 3A | *ADMIN darf keine `OWNER`-Rolle vergeben/entziehen |
| `PATCH /users/:id` (Status `ACTIVE⇄SUSPENDED`) | ✅ | ✅ | ❌ | ❌ | 3A | Verwaltungsaktion |
| `PATCH /users/:id` (Status `LOCKED→ACTIVE`, manuell) | ✅ | ✅ | ❌ | ❌ | 3B | Verwaltungsaktion, neuer Statuswert auf bestehendem Endpunkt |
| `DELETE /users/:id` | ✅ | ✅ | ❌ | ❌ | 3A | Kritisch, i. d. R. final |
| `PATCH /users/me/password` | ✅ | ✅ | ✅ | ✅ | 3A | Selbstverwaltung |
| `POST /invitations` (Rolle ≠ OWNER) | ✅ | ✅ | ❌ | ❌ | 3B | Verwaltungsaktion |
| `POST /invitations` (Rolle = OWNER) | ✅ | ❌ | ❌ | ❌ | 3B | Privilege-Escalation-Schutz |
| `DELETE /invitations/:id` | ✅ | ✅ | ❌ | ❌ | 3B | Symmetrisch zur Erstellung |
| `GET /invitations` | ✅ | ✅ | ❌ | ❌ | 3B | Enthält E-Mails noch nicht beigetretener Personen |
| `POST /invitations/:token/accept` | *(öffentlich)* | | | | 3B | Kein Login-Kontext vorhanden |
| `POST /password-resets` | *(öffentlich)* | | | | 3B | dito |
| `POST /password-resets/:token/consume` | *(öffentlich)* | | | | 3B | dito |

**Business-Regeln (unverändert aus Revision 1, jetzt mit konkreter
Transaktionsgrenze in Kap. 9 hinterlegt):**

1. Kein Selbst-Downgrade/-Deaktivierung des letzten `OWNER` (Kap. 9, T1).
2. `ADMIN` darf keine `OWNER`-Rolle vergeben/entziehen.
3. Ein User kann sich nicht selbst über `DELETE /users/:id`
   deaktivieren.

---

## 6. Soft Delete

Empfehlung unverändert: **Soft Delete, kein physisches Löschen**
(Begründung siehe Revision 1 — Audit-/FK-Integrität,
Compliance-Nachvollziehbarkeit, Konsistenz zum bestehenden
Organization-Statusmodell).

### 6.1 `deletedByUserId` — finale Entscheidung (Review-Punkt 11)

**Entscheidung: echte Prisma-Relation, kein loser String.**

```prisma
model User {
  // ...
  deletedAt       DateTime?
  deletedByUserId String?
  deletedByUser   User?     @relation("UserDeletedBy", fields: [deletedByUserId], references: [id])
  // Rückseite der Selbstreferenz (Prisma verlangt einen benannten
  // Gegenpart bei Self-Relations):
  disabledUsers   User[]    @relation("UserDeletedBy")
}
```

**Begründung:**

- **Konsistenz mit bestehendem Muster:** `Task` referenziert bereits
  `User` zweifach über benannte Relationen (`assignedUser`,
  `createdByUser`, siehe Sprint-1-Schema). Eine dritte, ähnlich
  aufgebaute Relation auf `User` selbst (Self-Relation) folgt exakt
  demselben, bereits im Projekt etablierten Stil — keine neue
  Modellierungsidee.
- **Referentielle Integrität ohne Kaskadenrisiko:** Da Soft Delete
  bedeutet, dass **keine** Zeile jemals physisch gelöscht wird, gibt es
  kein Szenario, in dem ein `ON DELETE CASCADE`/`RESTRICT` auf dieser
  Relation jemals zu einem harten Löschkonflikt führen könnte — das
  übliche Argument gegen Self-Relation-FKs bei tatsächlichem Hard-Delete
  (zirkuläre Lösch-Constraints) entfällt hier vollständig.
- **Nutzen:** `include: { deletedByUser: true }` liefert direkt Name/
  E-Mail des deaktivierenden Admins für Anzeige-/Audit-Zwecke, ohne
  einen zusätzlichen manuellen Lookup — bei einem losen String müsste
  jede Konsument:in diesen Lookup selbst nachbauen.
- **Kein sinnvolles Gegenargument gefunden:** Der einzige generelle
  Nachteil einer FK-Relation (Schreibkosten beim Setzen, minimal) ist
  hier vernachlässigbar, da `DELETE /users/:id` ohnehin eine seltene,
  nicht performancekritische Admin-Aktion ist.

`onDelete`-Verhalten: `SetNull` (Prisma-Default für optionale
Relationen, unverändert zum bestehenden Muster bei
`Task.assignedUserId`) — falls der deaktivierende Admin selbst
irgendwann (durch einen künftigen, heute nicht existierenden
Hard-Delete-Prozess) entfernt würde, bliebe der deaktivierte User
korrekt bestehen, nur ohne Zuordnung, wer ihn deaktiviert hat.

### 6.2 Sichtbarkeit (unverändert aus Revision 1)

`GET /users` blendet `DISABLED`-User standardmäßig aus,
`?includeDisabled=true` zeigt sie zusätzlich. E-Mail eines
soft-deleted Users bleibt in der Organization dauerhaft blockiert
(D14, unverändert).

---

## 7. Audit

Liste unverändert gegenüber Revision 1 (`USER_UPDATED`,
`USER_ROLE_CHANGED`, `USER_STATUS_CHANGED`, `USER_DISABLED`,
`USER_PASSWORD_CHANGED`, `INVITATION_CREATED`, `INVITATION_ACCEPTED`,
`INVITATION_REVOKED`, `USER_CREATED`, `PASSWORD_RESET_REQUESTED`,
`PASSWORD_RESET_COMPLETED`, `USER_LOCKED`, `USER_UNLOCKED`), jeweils mit
Phasen-Zuordnung wie in Kap. 4/5.

**Verbindliche Ergänzung (Review-Punkt 9):**

> **Tokens und Token-Hashes erscheinen niemals in `AuditEvent.metadata`
> und niemals in Log-Ausgaben — auf keinem Log-Level.**

Konkret bedeutet das für die Implementierung (Vorgabe für Sprint 3A/3B,
nicht optional):

- `InvitationsService`/`PasswordResetService` reichen an `AuditService`
  ausschließlich fachliche Metadaten weiter (`email`, `role`, `userId`,
  resultierender `status`) — niemals `tokenHash`, niemals den
  Klartext-Token, niemals einen Teilstring davon.
- Etwaige `Logger.debug()`/`Logger.error()`-Aufrufe in diesen Services
  dürfen den Token/Hash ebenfalls nicht ausgeben (auch nicht in
  Fehlerfällen wie „Token ungültig“ — die Fehlermeldung nennt den Grund,
  nicht den Wert).
- Dieser Grundsatz gilt unabhängig vom `ALLOW_DEV_AUTH_TOKENS`-Schalter
  (Kap. 4): Dieser Schalter betrifft ausschließlich die
  **API-Response** an den unmittelbaren Aufrufer eines
  `POST /invitations`/`POST /password-resets`-Requests, niemals Logs
  oder Audit.

---

## 8. Migrationen (Beschreibung, keine SQL)

Getrennt nach Phase (Review-Punkt 10), jeweils mehrere kleine, thematisch
getrennte Migrationen (bestehender Stil aus Sprint 2/2.1 fortgeführt).

### Sprint 3A

1. `AlterEnum "UserStatus"`: Wert `DISABLED` ergänzen.
2. `AlterTable "users"`: `deletedAt`, `deletedByUserId` ergänzen (beide
   nullable), FK-Constraint auf `deletedByUserId → users.id`
   (`ON DELETE SET NULL`, siehe Kap. 6.1), Index auf `deletedByUserId`.
3. *(Empfohlen, optional/nachziehbar)* Raw-SQL-Folgemigration analog zu
   ADR-002: defensiver `CHECK`-Constraint
   `email = lower(btrim(email))` auf `users` — reine Absicherung der
   bereits in der Anwendung erzwungenen Normalisierung (Review-Punkt 3),
   kein Ersatz dafür.

### Sprint 3B

4. `AlterEnum "UserStatus"`: Wert `LOCKED` ergänzen.
5. `AlterTable "users"`: `failedLoginAttempts` (`Int`, Default `0`),
   `lockedAt` (nullable) ergänzen.
6. `CreateEnum "InvitationStatus"`.
7. `CreateTable "invitations"` inkl. gewöhnlichem
   `@@index([organizationId, email])` und FKs zu `organizations`/`users`.
8. **Raw-SQL-Folgemigration (Review-Punkt 2, zwingend, nicht optional):**
   partieller Unique Index, sinngemäß
   `CREATE UNIQUE INDEX ... ON invitations (organization_id, email) WHERE status = 'PENDING'`
   — kann von Prisma nicht generiert werden, muss wie beim
   `task_assignment_xor_check`-Präzedenzfall manuell als eigene
   Migration nachgezogen werden (`prisma migrate dev --create-only` +
   Einfügen der SQL, siehe ADR-002-Vorgehen).
9. `CreateTable "password_reset_tokens"` inkl. Index/FK.
10. *(Empfohlen, optional/nachziehbar)* analoger defensiver
    `CHECK`-Constraint `email = lower(btrim(email))` auf `invitations`.

Migrationen 3/10 werden nicht als „zwingend vor Implementierungsstart"
eingestuft (sie sind reine Zusatzabsicherung, kein Ersatz für die
Anwendungslogik), Migration 8 hingegen **ist zwingend**, da sie die
in Review-Punkt 2 geforderte Garantie erst tatsächlich herstellt — ein
Vergessen dieser Migration würde die in Kap. 9 (T2) beschriebene
Race-Absicherung auf reine Anwendungslogik reduzieren, was der Review
explizit nicht wollte.

---

## 9. Transaktionsgrenzen (NEU)

Dieses Kapitel beschreibt für alle drei nebenläufigkeitskritischen
Abläufe die konkrete Transaktionsgrenze, die Isolationsstrategie und die
Konfliktbehandlung. **Gemeinsames Muster über alle drei:** Row-Lock auf
die jeweilige „Wahrheits“-Zeile per `SELECT ... FOR UPDATE` innerhalb
einer `Read Committed`-Transaktion, kontrollierter Geschäftsfehler
(`409`/`410`) statt Retry-Schleife. Bewusst **keine** durchgängige
`SERIALIZABLE`-Isolation mit Retry-Logik (siehe Begründung unter T1) —
konsistente Wahl über alle drei Fälle, damit im Code nicht mehrere
unterschiedliche Nebenläufigkeitsstrategien parallel existieren.

### T1 — Schutz des letzten OWNER (Review-Punkt 4)

**Problem:** Zwei parallele `PATCH`/`DELETE`-Requests könnten
unabhängig voneinander jeweils prüfen "gibt es noch einen anderen
OWNER?", beide `true` sehen (weil keiner der beiden das Ergebnis des
anderen kennt) und beide ausführen — Ergebnis: eine Organisation ganz
ohne `OWNER`.

**Mechanismus:** Row-Lock auf die `Organization`-Zeile als
Serialisierungspunkt für alle rollen-/statuskritischen Änderungen
innerhalb dieser Organisation.

```
BEGIN;
SELECT id FROM organizations WHERE id = :orgId FOR UPDATE;
  -- Exklusiver Lock; jede weitere Transaktion, die denselben Lock für
  -- dieselbe Organisation anfordert, wartet, statt parallel zu lesen.
SELECT COUNT(*) FROM users
  WHERE organization_id = :orgId AND role = 'OWNER'
    AND status = 'ACTIVE' AND deleted_at IS NULL;
  -- Anwendungslogik: wenn COUNT <= 1 UND die Zielaktion den letzten
  -- verbleibenden OWNER degradiert/suspendiert/deaktiviert
  -- → ROLLBACK, 409 Conflict.
UPDATE users SET role = ..., status = ... WHERE id = :targetUserId;
COMMIT;
```

**Isolation Level:** `Read Committed` (Postgres-Standard) genügt — der
explizite `FOR UPDATE`-Lock übernimmt die Serialisierung, keine
`SERIALIZABLE`-Isolation nötig.

**Decision Required war: Row-Lock+Warten vs. SERIALIZABLE+Retry.**
**Entschieden für Row-Lock+Warten**, Begründung:
- Seltene, kurze Admin-Transaktion — Warten statt Abbrechen ist für
  Endnutzer:innen unproblematisch und verständlicher als ein
  Retry-Loop.
- Kein Risiko wiederholter Serialisierungsfehler unter Last (bei
  `SERIALIZABLE` müsste der Client selbst erneut senden, hier nicht).
- Leicht nachvollziehbares mentales Modell: „eine Organisation = eine
  Warteschlange für kritische User-Änderungen“.

**Scope:** `PATCH /users/:id` (Rollenwechsel weg von `OWNER`,
Statuswechsel weg von `ACTIVE` bei einem `OWNER`) und
`DELETE /users/:id` (falls Ziel ein `OWNER` ist).

### T2 — Invitation Acceptance (Review-Punkt 5)

```
BEGIN;
SELECT * FROM invitations WHERE token_hash = :hash FOR UPDATE;
  -- Anwendungslogik: status != PENDING oder expiresAt < now()
  -- → ROLLBACK, 409/410.
INSERT INTO users (..., status) VALUES (..., 'ACTIVE');
UPDATE invitations SET status = 'ACCEPTED', accepted_at = now()
  WHERE id = :invitationId;
-- Audit: USER_CREATED, INVITATION_ACCEPTED (in derselben Transaktion,
-- analog zum bestehenden Muster aus AuditService-Aufrufen mit
-- `tx`-Parameter, siehe Sprint 1).
COMMIT;
```

Der `FOR UPDATE`-Lock auf die Invitation-Zeile reicht als
Serialisierungspunkt: ein zweiter, gleichzeitiger Accept-Versuch mit
demselben Token wartet auf den Lock, sieht danach `status = 'ACCEPTED'`
und bricht **kontrolliert** mit `409 Conflict` ab — kein technischer
Fehler, sondern ein korrekt erkannter, bereits verbrauchter
Geschäftszustand. Kein Retry nötig.

### T3 — Password Reset Consume (Review-Punkt 6, Statusregel aus
Review-Punkt 7)

```
BEGIN;
SELECT * FROM password_reset_tokens WHERE token_hash = :hash FOR UPDATE;
  -- Anwendungslogik: consumedAt IS NOT NULL oder expiresAt < now()
  -- → ROLLBACK, 409/410.
SELECT id, status FROM users WHERE id = :userId FOR UPDATE;

UPDATE users SET
  password_hash          = :newHash,
  token_version           = token_version + 1,
  failed_login_attempts   = 0,
  locked_at               = NULL,
  status = CASE WHEN status = 'LOCKED' THEN 'ACTIVE' ELSE status END
WHERE id = :userId;

UPDATE password_reset_tokens SET consumed_at = now() WHERE id = :tokenId;
-- Audit: PASSWORD_RESET_COMPLETED (userId, resultierender status —
-- kein tokenHash, siehe Kap. 7).
COMMIT;
```

Die `CASE WHEN`-Klausel **ist** die atomare Umsetzung von Review-Punkt 7:
Sie garantiert innerhalb desselben `UPDATE`-Statements, dass
ausschließlich `LOCKED → ACTIVE` automatisch erfolgt, während
`SUSPENDED`/`DISABLED`/`ACTIVE` unverändert bleiben — ganz ohne
separate, race-anfällige "erst lesen, dann in der Anwendung
entscheiden, dann schreiben"-Sequenz.

Der zusätzliche `FOR UPDATE`-Lock auf die `users`-Zeile verhindert eine
Überschneidung mit einer gleichzeitigen Admin-Aktion auf denselben User
(T1) — beide Transaktionen serialisieren sauber über denselben
Lock-Mechanismus.

### T4 — Automatische Entsperrung bei Login nach Ablauf der Sperrzeit
(Sprint 3B, Präzisierung aus Revision 3, hier nur als Platzhalter — wird
mit der Sprint-3B-Implementierung ausgearbeitet)

Referenziert aus Kap. 3.2. Grober Rahmen (Detailausarbeitung folgt in
Sprint 3B, **nicht Teil von Sprint 3A**):

```
UPDATE users SET
  status = CASE
    WHEN status = 'LOCKED' AND locked_at + :lockDuration < now() THEN 'ACTIVE'
    ELSE status
  END,
  failed_login_attempts = CASE
    WHEN status = 'LOCKED' AND locked_at + :lockDuration < now() THEN 0
    ELSE failed_login_attempts
  END,
  locked_at = CASE
    WHEN status = 'LOCKED' AND locked_at + :lockDuration < now() THEN NULL
    ELSE locked_at
  END
WHERE id = :userId
RETURNING status;
```

Ein einzelnes, atomares `UPDATE ... RETURNING` innerhalb derselben
Transaktion wie der restliche Login-Ablauf — analog zum `CASE WHEN`-
Muster aus T3 — statt eines separaten Read-then-Write. Der
zurückgegebene `status` entscheidet, ob `AuthService.login()` mit dem
Passwortvergleich fortfährt (`ACTIVE`) oder mit generischem `401`
abbricht (weiterhin `LOCKED`).

---

## 10. Teststrategie

### 10.1 Unit Tests (empfohlen: ~18–22, aufgeteilt 3A/3B)

**3A:**
- Letzter-OWNER-Schutz: Degradierung/Deaktivierung des letzten `OWNER`
  abgelehnt; bei zwei `OWNER`n erlaubt.
- `ADMIN` darf keine `OWNER`-Rolle vergeben/entziehen.
- `normalizeEmail()`: Groß-/Kleinschreibung, führende/folgende
  Leerzeichen, kombiniert.
- Soft-Delete-Service-Methode setzt `deletedAt`/`deletedByUserId`
  korrekt, `status = DISABLED`.

**3B:**
- `InvitationsService`: Ablehnen bei bestehendem `ACTIVE`/`INVITED`-User
  derselben normalisierten E-Mail.
- `InvitationsService`: Ablehnen bei bestehender `PENDING`-Invitation.
- `PasswordResetService`: `LOCKED → ACTIVE`, `SUSPENDED`/`DISABLED`
  bleiben unverändert (Statusmatrix vollständig durchtesten: alle 5
  Ausgangsstatus × erwartetes Ergebnis).
- `AuthService.login()`: Fehlversuchszähler erhöht sich nur bei
  `ACTIVE`+falschem Passwort, nicht bei `LOCKED`/`SUSPENDED`/`DISABLED`.
- Token-Hashing-Helfer: Determinismus, Kollisionsfreiheit bei
  unterschiedlichem Klartext.

### 10.2 Integration Tests (empfohlen: ~12–16, echte Test-DB)

**3A:**
- `DELETE /users/:id` → User verschwindet aus Standard-`GET /users`,
  erscheint mit `?includeDisabled=true`; referenzierte
  Tasks/AuditEvents bleiben abrufbar (FK `SetNull` greift nicht, da nur
  Soft Delete).
- Defensiver `CHECK`-Constraint (falls umgesetzt, siehe Kap. 8 Migration
  3): `INSERT`/`UPDATE` mit nicht-normalisierter E-Mail schlägt auf
  DB-Ebene fehl.
- **Race-Test T1 (korrigiert in Revision 3 — betrifft zwei
  unterschiedliche OWNER, nicht zweimal denselben):** Eine Organization
  hat genau zwei `ACTIVE` `OWNER` (A und B). Zwei parallele Requests
  (`Promise.all`) degradieren/deaktivieren **je einen der beiden
  unterschiedlichen** OWNER gleichzeitig (Request 1: degradiert A,
  Request 2: degradiert B — **nicht** beide denselben). Erwartet: genau
  einer der beiden Requests liefert `200`, der andere `409 Conflict`
  (unabhängig davon, welcher zuerst den Lock erhält). Nach Abschluss
  beider Requests muss die Organization **exakt einen** verbleibenden
  `ACTIVE` `OWNER` haben — nie null, nie zwei. Dieser Test ist der
  eigentliche Beweis für T1: Ein Test, der zweimal denselben OWNER
  anspricht, würde nur eine triviale Idempotenz-Eigenschaft prüfen, nicht
  die tatsächliche Zähl-Invariante über mehrere unterschiedliche Zeilen.

**3B:**
- **Race-Test partieller Unique Index (Review-Punkt 2):** zwei
  gleichzeitige `INSERT`s auf `invitations` mit identischer
  `(organizationId, email)` und `status = PENDING` — genau einer muss
  auf DB-Ebene mit Constraint-Verletzung scheitern (echter Beweis, dass
  Migration 8 aus Kap. 8 wirkt, nicht nur die Anwendungsprüfung).
- **Race-Test T2:** zwei parallele `POST /invitations/:token/accept`
  mit demselben Token — genau eine `200`/User-Anlage, genau eine `409`.
- **Race-Test T3:** zwei parallele `POST /password-resets/:token/consume`
  mit demselben Token — genau eine erfolgreich, genau eine `409`/`410`.
- `LOCKED`-Übergang nach N Fehlversuchen; automatische Entsperrung nach
  Zeitfenster (Fake-Timers).

### 10.3 E2E Tests (empfohlen: ~22–28, analog Umfang Sprint 2/2.1)

**3A:**
- RBAC-Matrix-Tests für alle 3A-Endpunkte × alle vier Rollen
  (erlaubt/verboten), analog zur bestehenden Teststruktur.
- Cross-Tenant-Isolation für `PATCH`/`DELETE /users/:id` (unverändertes
  Muster aus Sprint 2).
- Letzter-OWNER-Schutz End-to-End (`409`, siehe D16).
- Soft-Delete-Interaktion mit Task-Zuweisung: ein `DISABLED`-User kann
  keiner **neuen** Task zugewiesen werden, bleibt aber auf bereits
  bestehenden Tasks sichtbar.

**3B:**
- Kompletter Invite-Flow: `OWNER` lädt ein → `POST /invitations/:token/accept`
  → Login mit neuem Account möglich.
- Kompletter Reset-Flow inkl. alter Token wird durch `tokenVersion`
  entwertet (Wiederverwendung des Sprint-2/2.1-Testmusters).
- Reset für `SUSPENDED`/`DISABLED`-User: Passwort wird gesetzt, aber
  **keine** Login-Fähigkeit, **kein** Token in der Response
  (Review-Punkt 7, siehe Kap. 4B.6).
- **Dev-Token-Gating (Review-Punkt 8):**
  `ALLOW_DEV_AUTH_TOKENS=false` (Default) → Token fehlt in der
  `POST /invitations`/`POST /password-resets`-Response;
  `ALLOW_DEV_AUTH_TOKENS=true` → Token vorhanden; Startup-Test analog zu
  bestehendem `ALLOW_INSECURE_TENANT_HEADER`-Test:
  `ALLOW_INSECURE_TENANT_HEADER=true` + `NODE_ENV=production` →
  Prozess beendet sich beim Start (bestehender Mechanismus,
  wiederverwendet).
- **Audit-Inhalt-Test (Review-Punkt 9):** nach Invite-/Reset-Flow wird
  das zugehörige `AuditEvent.metadata` per Snapshot/Feld-Check geprüft —
  es darf **keinen** String enthalten, der dem bekannten Klartext-Token
  oder seinem Hash entspricht.
- `LOCKED` nach N Fehlversuchen, weiterhin `401` mit korrektem Passwort
  bis Entsperrung; Entsperrung via Reset **oder** via Admin-`PATCH`.

---

## 11. Risiken

1. **Row-Lock-Kontention bei T1.** Wird eine Organisation ungewöhnlich
   häufig gleichzeitig administriert (viele parallele
   Rollen-/Statusänderungen), serialisieren sich diese Requests
   vollständig über den `Organization`-Lock — für die zu erwartende
   Nutzung (seltene Admin-Aktionen) unkritisch, aber im Review als
   bewusster Trade-off festzuhalten.
2. **Der partielle Unique Index (Migration 8, Kap. 8) ist ein
   wiederkehrendes Muster außerhalb der Prisma-Schema-DSL** — wie schon
   der CHECK-Constraint aus Sprint 1 (ADR-002) muss bei jeder
   Neuerstellung der Migrationshistorie (z. B. `prisma migrate reset` in
   einer neuen Umgebung) sichergestellt sein, dass diese Migration nicht
   versehentlich übersprungen wird. Empfehlung: ein Integrationstest
   (Kap. 10.2) macht eine fehlende Migration sofort sichtbar.
3. **Zwischenzustand während 3A (`POST /users` bleibt vorübergehend
   bestehen).** Muss klar kommuniziert werden (README-Hinweis „wird mit
   3B entfernt"), sonst Verwirrung, welcher Weg der „richtige“ ist.
4. **`ALLOW_DEV_AUTH_TOKENS` könnte in einer Staging-Umgebung versehentlich
   aktiv bleiben**, die fälschlich nicht als `NODE_ENV=production`
   erkannt wird. Gleiches Restrisiko wie beim bestehenden
   `ALLOW_INSECURE_TENANT_HEADER` — keine neue Risikoklasse, aber die
   Fläche verdoppelt sich mit einem zweiten Schalter.
5. **E-Mail-Normalisierung nur bei Neuschreibvorgängen.** Bestehende
   `User.email`-Werte aus Sprint 1/2 (vor Einführung von
   `normalizeEmail()`) werden durch die Migration **nicht**
   rückwirkend normalisiert (kein Daten-Backfill in diesem Design
   vorgesehen). Falls bereits nicht-normalisierte E-Mails existieren,
   könnte der optionale defensive CHECK-Constraint (Kap. 8, Migration 3)
   fehlschlagen — muss vor dessen Einführung per Backfill-Skript
   geprüft/bereinigt werden. **Nicht Teil dieses Designs**, aber als
   Voraussetzung für Migration 3 hier vermerkt.
6. **Self-Relation `deletedByUserId` erhöht die FK-Anzahl auf `users`
   weiter** (bereits mehrere FKs von `Task` aus, jetzt zusätzlich eine
   von `User` auf sich selbst) — rein strukturell, kein funktionales
   Risiko, aber bei künftigen Schema-Änderungen an `User` als weiterer
   Abhängigkeitspunkt zu beachten.

---

## 12. Empfehlungen — was bewusst auf Sprint 4+ verschoben wird

Unverändert gegenüber Revision 1: E-Mail-Versand-Infrastruktur,
globale/Cross-Org-Identität, feingranulare
Login-Attempt-Historie/Geräte-Tracking, `UserPreferences`,
Cursor-Pagination, Bulk-User-Import, Digital-Employee-Service-Accounts.
Zusätzlich neu:

- **Backfill bestehender, nicht-normalisierter E-Mail-Adressen** (siehe
  Risiko 5) — eigenständiges, kleines Migrations-Skript, bewusst nicht
  Teil von Sprint 3A/3B, da es Datenbereinigung statt neues Verhalten
  ist.
- **Konfigurierbarkeit der `LOCKED`-Schwellwerte** über Environment
  (`ACCOUNT_LOCK_THRESHOLD`, `ACCOUNT_LOCK_DURATION_MINUTES`) — Design
  sieht das vor (Kap. 3), konkrete Default-Werte sollten aber erst mit
  Produkt-Feedback aus 3B final festgelegt werden, nicht aus der
  Architektur allein.

---

## 13. Decision-Required-Tabelle

### 13.1 In Revision 2 entschieden (nicht mehr offen)

| # | Thema | Entscheidung |
|---|---|---|
| D2 (alt) | `SUSPENDED` vs. `DISABLED` | Getrennt gehalten, jetzt zusätzlich klar von `Organization.status` entkoppelt (Review-Punkt 1) |
| D3 (alt) | Invitation-Token-Format | Opakes DB-Token (unverändert), Eindeutigkeit jetzt korrekt über partiellen Index statt fehlerhaftem `@@unique` |
| D9 (alt) | Dev-Token-Sichtbarkeit | `ALLOW_DEV_AUTH_TOKENS`, explizit, Default `false`, harter Production-Block (Review-Punkt 8) |
| D12 (alt) | Letzter-OWNER-Mechanismus | Row-Lock (`FOR UPDATE`) + Read Committed, kein Serializable+Retry (Kap. 9, T1) |
| — | `deletedByUserId` | Echte Relation (Kap. 6.1, Review-Punkt 11) |
| — | E-Mail-Normalisierung | Zentrale `normalizeEmail()`-Funktion, Anwendungsebene verbindlich, DB-CHECK optional/defensiv |
| — | Invitation-Acceptance-Atomarität | Row-Lock auf Invitation-Zeile (Kap. 9, T2) |
| — | Password-Reset-Atomarität + Statusregel | Row-Lock + `CASE WHEN` im UPDATE (Kap. 9, T3) |
| — | Sprint-Aufteilung | 3A (Administration) / 3B (Identity Lifecycle), siehe Kap. 4 |

### 13.2 Weiterhin offen

| # | Thema | Optionen | Empfehlung |
|---|---|---|---|
| D1 | `UserPreferences` jetzt einführen? | Tabelle / JSON / verschieben | Verschieben |
| D4 | Mehrfach-Invitations pro E-Mail (historisch) | Mehrere Zeilen / harte 1:1 | Mehrere Zeilen |
| D5 | `POST /users` entfernen | Sofort (3A) / mit 3B-Cutover | Mit 3B-Cutover (siehe Kap. 4, Risiko 3) |
| D6 | Pagination für `GET /users` | Offset/Limit / Cursor | Offset/Limit |
| D7 | Passwort ändern: neues Token in Response? | Ja / erzwungener Re-Login | Ja |
| D8 | Pfad-Konvention Selbstverwaltung | `/users/me/...` / `/account/...` | `/users/me/...` |
| D10 | `LOCKED`-Schwellwerte (exakte Zahlen) | Verschiedene Defaults denkbar | Konfigurierbar, finale Zahl erst mit Produkt-Feedback (siehe Kap. 12) |
| D13 | `GET /users` Default-Sichtbarkeit `DISABLED` | Ausblenden+Opt-in / immer zeigen | Ausblenden, Opt-in |
| D14 | E-Mail-Wiederverwendung nach Soft Delete | Constraint lockern / dauerhaft blockieren | Dauerhaft blockieren |
| D15 | Migrationsgranularität | Eine große / mehrere kleine | Mehrere kleine (siehe Kap. 8) |
| D16 | Statuscode Letzter-OWNER-Konflikt | `400` / `409` | `409` |
| **D17 (neu)** | Reset-Response bei `SUSPENDED`/`DISABLED`: `200` ohne Token vs. `403`? | `200` ohne Token (Kap. 4B.6) / `403` | `200` ohne Token — verhindert, dass die Statusabfrage selbst zum Enumeration-Vektor wird ("403 verrät, dass der Account existiert und gesperrt ist") |
| **D18 (neu)** | Defensive CHECK-Constraints (E-Mail-Normalisierung) verpflichtend oder optional? | Verpflichtend / optional/nachziehbar | Optional/nachziehbar (Kap. 8) — abhängig vom Ergebnis des in Risiko 5 genannten Backfills |

---

**Gesamtempfehlung:** Design in dieser Form für Sprint 3A freigeben.
Sprint 3A hat keine offenen, sicherheitskritischen Punkte mehr (T1 ist
vollständig spezifiziert, Soft-Delete-Relation entschieden). Sprint 3B
hängt zusätzlich an D17 (Reset-Response-Verhalten) — sollte vor
3B-Implementierungsstart kurz bestätigt werden, ist aber kein Blocker
für den 3A-Start.
