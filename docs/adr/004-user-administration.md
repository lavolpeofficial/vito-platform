# ADR-004: User Administration (Sprint 3A)

## Status
Akzeptiert

## Kontext
Sprint 3 (siehe `docs/design/sprint-3-user-management-design.md`,
Revision 3) teilt die vollständige User-Management-Funktionalität in
zwei Phasen: **3A — User Administration** (Verwaltung bestehender User
auf Basis des unveränderten Sprint-2/2.1-Login-Mechanismus) und
**3B — Identity Lifecycle** (Invitation, Password Reset, automatischer
Account-Lockout). Dieses ADR dokumentiert die in Sprint 3A getroffenen,
konkreten Umsetzungsentscheidungen.

## Entscheidungen

### 1. Soft Delete statt physischem Löschen

`DELETE /users/:id` setzt `status = DISABLED`, `deletedAt = now()`,
`deletedByUserId = <aufrufender User>` und erhöht `tokenVersion` — es
gibt kein SQL-`DELETE`. Begründung: Audit-/FK-Integrität
(`AuditEvent.actorId`, `Task.createdByUserId`/`assignedUserId`
referenzieren User; ein physisch gelöschter User würde diese Historie
zerstören oder in `NULL`-Zustände versetzen), Konsistenz zum bereits
bestehenden Organization-Statusmodell (`ACTIVE → SUSPENDED → ARCHIVED`,
ebenfalls ohne physisches Löschen). Ausführliche Begründung: Sprint-3-
Design, Kap. 6.

### 2. `deletedByUserId` als echte, benannte Self-Relation

```prisma
deletedByUser User?  @relation("UserDeletedBy", fields: [deletedByUserId], references: [id], onDelete: SetNull)
disabledUsers User[] @relation("UserDeletedBy")
```

Statt eines losen `String`-Felds — konsistent mit den bereits
bestehenden `Task.assignedUserId`/`Task.createdByUserId`-Relationen auf
`User`. Da Soft Delete bedeutet, dass niemals eine Zeile physisch
gelöscht wird, entfällt das übliche Gegenargument gegen
Self-Relation-FKs (zirkuläre Lösch-Constraints). `onDelete: SetNull`
ist der Prisma-Default für optionale Relationen, hier zur Klarheit
explizit angegeben.

### 3. Letzter-OWNER-Schutz: transaktionaler Row-Lock statt reiner
Anwendungslogik

Jede Aktion, die den letzten verbleibenden aktiven `OWNER` einer
Organization degradieren, suspendieren oder deaktivieren würde, läuft
innerhalb einer Datenbanktransaktion, die zunächst die
`Organization`-Zeile per `SELECT ... FOR UPDATE` sperrt:

```sql
BEGIN;
SELECT id FROM organizations WHERE id = $1 FOR UPDATE;
-- COUNT der aktiven OWNER (ohne Zielnutzer) prüfen, ggf. ROLLBACK + 409
UPDATE users SET role = ..., status = ... WHERE id = $2;
COMMIT;
```

**Warum Row-Lock statt `SERIALIZABLE` + Retry:** Kurze, seltene
Admin-Transaktion — Warten statt Aborten ist für Endnutzer:innen
unproblematisch, es gibt kein Retry-Loop-Risiko unter Last, und das
mentale Modell ("eine Organization = eine Warteschlange für kritische
User-Änderungen") ist leicht nachvollziehbar. `Read Committed`
(Postgres-Standard) genügt, da der explizite Lock die Serialisierung
übernimmt. Ausführliche Begründung inkl. Alternativenabwägung:
Sprint-3-Design, Kap. 9 (T1).

**Verifikation:** Ein dedizierter E2E-Race-Test
(`test/app.e2e-spec.ts`, „Race-Test: zwei parallele Requests gegen zwei
unterschiedliche verbleibende OWNER") sendet zwei parallele Requests
gegen zwei **unterschiedliche** verbleibende OWNER derselben
Organization; erwartet wird genau ein `200` und genau ein `409`, und im
Anschluss exakt ein verbleibender aktiver OWNER. Ein Test, der zweimal
denselben OWNER anspricht, würde nur eine triviale
Idempotenz-Eigenschaft prüfen, nicht die eigentliche Zähl-Invariante —
dieser Unterschied wurde im Architektur-Review explizit korrigiert
(siehe Sprint-3-Design Revision 3).

### 4. `tokenVersion`-Erhöhung bei Rollenwechsel und Suspendierung

`PATCH /users/:id` erhöht `tokenVersion`, wenn sich die Rolle ändert
oder der Status auf `SUSPENDED` wechselt — nicht bei reiner
Namensänderung oder bei Reaktivierung (`SUSPENDED → ACTIVE`).
Begründung: Rollenwechsel und Suspendierung sind
sicherheitsrelevant genug, um bereits ausgestellte Tokens sofort zu
entwerten (Wiederverwendung des in Sprint 2.1 eingeführten
`tokenVersion`-Mechanismus); eine Reaktivierung ist es nicht (es gab
ohnehin kein gültiges Token für einen bereits suspendierten User, das
noch entwertet werden müsste — ein zuvor gültiges Token wurde bereits
bei der ursprünglichen Suspendierung entwertet).

### 5. `PATCH /users/me/password` liefert ein neues JWT direkt in der
Antwort

Statt einen erzwungenen Re-Login zu verlangen. Der User hat sich durch
`currentPassword` gerade erneut authentifiziert; ein Zwangs-Re-Login
wäre reine Reibung ohne Sicherheitsgewinn (Entscheidung bereits im
Sprint-3-Design als D7 vorgezeichnet, hier final umgesetzt).
`AuthService.issueTokenFor()` wurde aus dem bestehenden Login-Pfad
extrahiert und wird von `UsersService.changeOwnPassword()`
wiederverwendet, damit es nur eine einzige Stelle gibt, an der
Token-Claims zusammengestellt werden.

### 6. Zentrale E-Mail-Normalisierung

`common/utils/normalize-email.ts` (`trim().toLowerCase()`) wird von
`AuthService.login()` und `UsersService.create()` genutzt.
`LoginDto`/`CreateUserDto` trimmen die E-Mail bereits vor der
`@IsEmail()`-Validierung (via `class-transformer`-`@Transform`), damit
ein Leerzeichen am Anfang/Ende nicht bereits am DTO-Validierungslayer
scheitert, bevor `normalizeEmail()` greifen kann. Ein defensiver
DB-`CHECK`-Constraint wurde **bewusst nicht** in Sprint 3A eingeführt
(siehe „Bekannte Einschränkungen" unten) — Bestandsdaten wurden nicht
auf Normalisierung geprüft, ein blind eingeführter Constraint könnte
bestehende Zeilen brechen.

### 7. Kein neuer DB-Constraint für die Letzter-OWNER-Invariante

Anders als bei der Task-Assignment-Invariante (ADR-002, einzeilige
XOR-Bedingung) lässt sich "mindestens ein aktiver OWNER pro
Organization" nicht als einzeiliger `CHECK`-Constraint ausdrücken (es
ist eine aggregierte Bedingung über mehrere Zeilen). Die Absicherung
erfolgt daher ausschließlich transaktional auf Anwendungsebene (siehe
Punkt 3) — konsistent mit der bereits im Sprint-3-Design (D12)
getroffenen Analyse.

## Bekannte Einschränkungen dieser Entscheidungen

- Der Row-Lock auf `Organization` serialisiert **alle**
  rollen-/statuskritischen `PATCH`/`DELETE /users/:id`-Requests einer
  Organization untereinander — bei ungewöhnlich hoher paralleler
  Admin-Aktivität in derselben Organization würden sich Requests
  gegenseitig kurz blockieren. Für die erwartete Nutzung (seltene
  Admin-Aktionen) unkritisch.
- Kein defensiver DB-`CHECK`-Constraint für E-Mail-Normalisierung in
  Sprint 3A (siehe Punkt 6) — reine Anwendungsebene. Nachziehbar in
  einer späteren Migration, sobald Bestandsdaten geprüft/bereinigt sind.
- `POST /users` bleibt unverändert bestehen (kein Passwort setzbar,
  kein Invite-Flow) bis zum Sprint-3B-Cutover.

## Konsequenzen

- Sprint 3B kann auf denselben Transaktions-/Lock-Mustern aufbauen
  (Invitation Acceptance, Password Reset — siehe Sprint-3-Design,
  Kap. 9, T2/T3/T4) statt neue Nebenläufigkeitsstrategien einzuführen.
- `AuthService.issueTokenFor()` ist jetzt die einzige Stelle, an der
  JWTs signiert werden — sowohl Login als auch Passwort-Änderung (und
  künftig Invitation Acceptance/Password Reset in 3B) nutzen dieselbe
  Funktion.
