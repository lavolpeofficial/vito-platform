# ADR-003: JWT-Derived Tenant Context and MVP Authorization

## Status
Akzeptiert

## Kontext
Sprint 1 etablierte Mandantentrennung ausschließlich über den ungeprüften
Header `X-Organization-Id` (siehe ADR-001) — explizit als
Development-/Prototype-Mechanismus, ausdrücklich ungeeignet als
produktive Sicherheitsgrenze. Sprint 2 ersetzt diesen Mechanismus durch
JWT-basierte Authentifizierung mit einer minimalen, aber vollständigen
rollenbasierten Autorisierung.

## Trust Boundary

**Vor Sprint 2:** Jeder Client, der eine syntaktisch gültige UUID im
Header `X-Organization-Id` sendet, wurde vollständig als Mitglied dieser
Organization behandelt. Es gab keine Trust Boundary im eigentlichen Sinn.

**Seit Sprint 2:** Die Trust Boundary liegt an der Signaturprüfung des
JWT (`JwtStrategy`, Secret aus `JWT_SECRET`) **plus** einer Per-Request-
Prüfung gegen die Datenbank (siehe „Tenant-Sicherheitsprüfung“ unten).
Innerhalb dieser Boundary gilt:

- `organizationId` stammt **ausschließlich** aus dem verifizierten Token
  (Claim `org_id`), niemals aus einem client-gesteuerten Header, sobald
  ein `Authorization`-Header vorhanden ist. `X-Organization-Id` wird in
  diesem Fall vom `JwtAuthGuard` überhaupt nicht gelesen — er kann ein
  gültiges JWT also strukturell nicht überschreiben.
- Der einzige verbleibende Header-Pfad
  (`ALLOW_INSECURE_TENANT_HEADER=true`, nur ohne `Authorization`-Header)
  bleibt außerhalb dieser Trust Boundary: er liefert keine `role` und
  wird von jedem `@Roles(...)`-geschützten Endpunkt abgelehnt. Er ist für
  produktive/sensible Daten nicht vorgesehen und in `NODE_ENV=production`
  durch einen harten Startup-Check blockiert (`main.ts`).

## Token Claims

Das JWT enthält bewusst minimale Claims:

```json
{
  "sub": "<userId>",
  "org_id": "<organizationId>",
  "role": "OWNER | ADMIN | MEMBER | VIEWER",
  "iat": ...,
  "exp": ...
}
```

Explizit **nicht** im Token: E-Mail, Name, `passwordHash`, oder sonstige
personenbezogene/sensible Daten — das Token soll bei Bedarf geloggt oder
in Client-Storage abgelegt werden können, ohne selbst zur sensiblen
Datenquelle zu werden. E-Mail/Name werden bei Bedarf frisch aus der
Datenbank geladen (z. B. für `@CurrentUser()`-Antworten wie die
Login-Response), nicht aus dem Token entnommen.

## Rollenmodell

Vier feste Rollen (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`, bereits Teil des
Domänenmodells aus Sprint 1). Durchsetzung über `@Roles(...)`-Decorator +
globalen `RolesGuard`:

| Aktion                                             | OWNER | ADMIN | MEMBER | VIEWER |
|-----------------------------------------------------|:-----:|:-----:|:------:|:------:|
| Tasks lesen                                          | ✅    | ✅    | ✅     | ✅     |
| Tasks erstellen/bearbeiten/abschließen               | ✅    | ✅    | ✅     | ❌     |
| DigitalEmployees/Capabilities lesen                  | ✅    | ✅    | ✅     | ✅     |
| DigitalEmployees/Capabilities anlegen/ändern/grant/revoke | ✅ | ✅  | ❌     | ❌     |
| Users anlegen                                        | ✅    | ✅    | ❌     | ❌     |
| AuditEvents lesen                                    | ✅    | ✅    | ❌     | ❌     |

Bewusst **keine** komplexe Permission Engine (keine Ressourcen-Ownership,
keine feingranularen Scopes, keine dynamischen Policies) — das wäre für
den aktuellen Funktionsumfang Überengineering. `RolesGuard` prüft nur:
"Hat der Endpunkt `@Roles(...)`? Ist die Rolle aus `TenantContext` in
dieser Liste?" Ohne `@Roles(...)` reicht Authentifizierung allein.

`POST /organizations` ist bewusst **ohne** Rollenbeschränkung (nur
Authentifizierung nötig) — siehe „Verbleibende Risiken“, dieser
Endpunkt hat noch keine fachlich saubere Rollenzuordnung, da es keine
Platform-Admin-Rolle gibt.

## Development-Header-Ausnahme

`ALLOW_INSECURE_TENANT_HEADER=true` reaktiviert den alten
`X-Organization-Id`-Mechanismus aus ADR-001, aber nur:

- wenn **kein** `Authorization`-Header im Request vorhanden ist (kann ein
  gültiges JWT also nie überschreiben),
- mit `role: null` im `TenantContext` — jeder `@Roles(...)`-geschützte
  Endpunkt lehnt diesen Pfad automatisch ab,
- niemals in `NODE_ENV=production`: `main.ts` prüft diese Kombination
  beim Start und beendet den Prozess sofort, statt nur zu warnen.

Zweck: lokale Entwicklung/Debugging ohne Login-Overhead für rein lesende
Zugriffe auf Endpunkte ohne Rollenbeschränkung.

## Tenant-Sicherheitsprüfung (Anforderung 7)

Ein gültig signiertes JWT allein wird **nicht** als ausreichend
betrachtet. `JwtStrategy.validate()` läuft bei **jedem** authentifizierten
Request (nicht nur beim Login) und lädt User + Organization frisch aus
der Datenbank, um zu erzwingen:

- der User (`sub`) existiert weiterhin,
- der User gehört weiterhin zur im Token stehenden Organization
  (`org_id`) — Verteidigung gegen ein gültig signiertes, aber inhaltlich
  veraltetes Token,
- `user.status === 'ACTIVE'`,
- `organization.status === 'ACTIVE'`.

**Gewählte Strategie:** Per-Request-DB-Check statt rein stateless JWT.

**Konsequenzen:**
- *Positiv:* Ein deaktivierter User oder eine suspendierte Organization
  verliert den Zugriff spätestens beim nächsten Request — nicht erst
  nach Ablauf der (kurzen) Token-Laufzeit. Das wurde in
  `test/app.e2e-spec.ts` real gegen ein zuvor gültiges Token getestet.
- *Kosten:* Ein zusätzlicher DB-Roundtrip pro authentifiziertem Request.
  Für das aktuelle Datenvolumen vernachlässigbar. Sollte dies später
  relevant werden, kann das Ergebnis kurzlebig (wenige Sekunden)
  gecacht werden, ohne diesen Baustein strukturell zu ändern.
- *Alternative verworfen:* rein stateless JWT-Vertrauen (keine DB-Prüfung)
  wäre performanter, hätte aber zur Folge, dass ein gesperrter
  User/eine suspendierte Organization bis zum Token-Ablauf weiter
  zugreifen könnte — für ein Sicherheits-MVP nicht akzeptabel.

## Token-Invalidierungsstrategie

Es gibt **keinen** Blacklist-/Revocation-Mechanismus und **keinen**
Refresh-Token-Flow. Invalidierung erfolgt über drei Mechanismen in
Kombination:

1. **Kurze Token-Laufzeit** (`JWT_EXPIRES_IN`, Default seit Sprint 2.1:
   `15m`, siehe Abschnitt „JWT Lifetime“ unten) begrenzt das Zeitfenster
   eines gestohlenen/kompromittierten Tokens.
2. **Per-Request-Sicherheitsprüfung** (siehe oben) sorgt dafür, dass
   Statusänderungen (User/Organization deaktiviert) unabhängig von der
   Token-Laufzeit sofort beim nächsten Request wirken.
3. **Token Versioning** (Sprint 2.1, siehe Abschnitt unten): Erhöhen von
   `User.tokenVersion` entwertet gezielt **alle** zuvor für diesen einen
   User ausgestellten Tokens sofort beim nächsten Request — ohne
   Blacklist.

Was diese Kombination **nicht** abdeckt: das gezielte Widerrufen eines
**einzelnen** Tokens (z. B. "nur die Session auf diesem einen Gerät"),
ohne gleichzeitig alle anderen Sessions desselben Users zu invalidieren
— `tokenVersion` wirkt pro User, nicht pro Token/Session. Für dieses
Sicherheits-MVP als akzeptabel bewertet; adressiert in „Verbleibende
Risiken“.

## Token Versioning (Sprint 2.1)

Ergänzt `User.tokenVersion Int @default(1)`. Der Claim `token_version` im
JWT wird beim Login aus dem aktuellen `User.tokenVersion` übernommen.
`JwtStrategy.validate()` vergleicht bei **jedem** Request
`payload.token_version === user.tokenVersion` (exakte Gleichheit) und
wirft `401`, wenn:

- der Claim fehlt (älteres Token-Format, vor Sprint 2.1 ausgestellt),
- der Claim einen anderen Wert als der aktuelle DB-Stand hat.

**Bewusst keine Blacklist.** Statt einzelne Token-IDs in einer separaten
Tabelle/einem Cache zu widerrufen (zusätzlicher Datenspeicher, TTL-
Pflege, Race-Conditions beim Aufräumen), reicht ein einzelner Integer pro
User: Erhöhen von `tokenVersion` (z. B. bei Passwort-Änderung, Verdacht
auf Kompromittierung, adminseitigem "alle Sessions abmelden") entwertet
**alle** zuvor für diesen User ausgestellten Tokens gleichzeitig, ohne
dass die Anwendung sich merken muss, welche Tokens im Umlauf sind.

**Trade-off:** granular (pro einzelnem Token/Gerät) kann so nicht
widerrufen werden — siehe „Verbleibende Risiken“.

## Login Rate Limiting (Sprint 2.1)

`POST /auth/login` ist über `@nestjs/throttler` gedrosselt: Default 5
Requests pro Minute pro IP (`LOGIN_RATE_LIMIT_MAX` /
`LOGIN_RATE_LIMIT_WINDOW_MS`), Antwort bei Überschreitung `429 Too Many
Requests`.

**Bewusst NICHT global.** `ThrottlerModule` wird ausschließlich in
`AuthModule` importiert; `ThrottlerGuard` wird gezielt per
`@UseGuards(ThrottlerGuard)` nur auf `AuthController.login()` angewendet
— nicht als globaler `APP_GUARD`. Andere Endpunkte (Tasks, DigitalEmployees,
...) bleiben ungedrosselt, da dort andere Schutzmechanismen greifen
(Authentifizierung, RBAC) und eine globale Drosselung in diesem Sprint
nicht gefordert war.

**Warum Login speziell:** `POST /auth/login` ist der einzige Endpunkt,
der mit reinem Rateraten (Brute-Force auf Passwörter) angegriffen werden
kann, ohne bereits ein gültiges Credential zu besitzen — alle anderen
Endpunkte setzen ohnehin ein gültiges JWT voraus.

## Helmet & Security Headers (Sprint 2.1)

`app.use(helmet())` wird in `main.ts` als eine der ersten Middlewares
registriert (vor Guards/Pipes). Helmet setzt Standard-Security-Header
(u. a. `X-Content-Type-Options: nosniff`, `X-Frame-Options`, eine
Basis-`Content-Security-Policy`, HSTS-Header, Entfernen von
`X-Powered-By`). Bewusst die Helmet-Standardkonfiguration übernommen
(keine Endpunkt-spezifische CSP-Feinjustierung), da VITO aktuell eine
reine JSON-API ohne eigenes Frontend/eigene Asset-Auslieferung ist.

**CORS** ergänzt Helmet um eine explizite Origin-Policy: In Produktion
wird `origin: "*"` bewusst vermieden. Erlaubte Origins kommen
ausschließlich aus `CORS_ALLOWED_ORIGINS` (kommagetrennte Liste); ist
diese in Produktion leer, werden Cross-Origin-Requests komplett
blockiert (`origin: false`) statt versehentlich offen zu sein. In
Development bleibt CORS permissiv (`origin: true`).

## JWT Lifetime (Sprint 2.1)

Default-Laufzeit auf `15m` reduziert (vorher `1h`), weiterhin
konfigurierbar über `JWT_EXPIRES_IN`. Kürzere Laufzeit verkleinert das
Zeitfenster, in dem ein gestohlenes, aber noch nicht durch
`tokenVersion`/Status-Prüfung entwertetes Token nutzbar bleibt.

## Warum noch keine Refresh Tokens

Bewusst zurückgestellt:

- Ein Refresh-Token-System bringt eigene Sicherheitsanforderungen mit
  (sichere Speicherung, Rotation, Widerruf bei Diebstahl, eigene
  Ablauflogik) — zusätzlicher, für diesen Hardening-Sprint nicht
  angeforderter Scope.
- Die kombinierten Mechanismen (kurze Laufzeit + Per-Request-DB-Check +
  `tokenVersion`) liefern für das aktuelle Bedrohungsmodell und
  Datenvolumen bereits eine spürbar verbesserte, klar dokumentierte
  Sicherheitsgrenze.
- Die kürzere Laufzeit (`15m`) bedeutet häufigeres Re-Login ohne
  Refresh-Flow — bewusster, dokumentierter UX-Kompromiss für dieses MVP;
  Empfehlung für einen künftigen Sprint (siehe README).
- Ein Refresh-Token-Flow lässt sich später als zusätzlicher
  Endpunkt/Claim ergänzen, ohne `AuthService`/`JwtStrategy`/
  `TenantContext` umzubauen.

## Warum POST /organizations deaktiviert wurde

Ausführliche Begründung in `docs/adr/001-modular-monolith-tenant-audit.md`
(Abschnitt „Ergänzung (Sprint 2.1): Deaktivierung von POST
/organizations“). Kurzfassung: Organization-Erstellung ist eine
sicherheitskritische Aktion (neue Mandantengrenze), für die "irgendein
eingeloggter User" keine angemessene Berechtigungsstufe ist, und das
aktuelle 4-Rollen-Modell ist organisationsintern und bildet keine
plattformweite Admin-Rolle ab. Statt einer unsauberen Rollenprüfung wird
der Endpunkt vollständig entfernt, bis ein echtes Platform-Admin-Konzept
existiert.

## Verbleibende Risiken

- **Kein Widerruf einzelner Tokens/Sessions.** `tokenVersion` (siehe
  oben) entwertet immer alle Tokens eines Users gemeinsam, nicht
  session-granular. Empfehlung: Refresh-Token-Rotation mit
  Session-IDs, falls Multi-Device-Session-Management vor Anbindung
  sensibler externer Systeme relevant wird.
- **Keine Organization-Erstellung über die API.** Bewusste
  Design-Entscheidung (siehe oben) — kein Sicherheitsrisiko, aber eine
  funktionale Einschränkung, die vor echtem Self-Service-Onboarding
  gelöst werden muss (Platform-Admin-Rolle).
- **`bcryptjs` (reine JS-Implementierung) statt nativem `bcrypt`/`argon2`.**
  Bewusste Entscheidung für Portabilität in eingeschränkten
  Build-/Sandbox-Umgebungen ohne native Kompilierung; funktional
  bcrypt-kompatibel und für das aktuelle Bedrohungsmodell ausreichend,
  aber langsamer als eine native Implementierung — bei Bedarf später
  gegen `argon2`/`bcrypt` (nativ) austauschbar, ohne die Schnittstelle
  (`AuthService`) zu ändern.
- **Kein Passwort-Reset, kein Invite-Flow.** Über `POST /users` angelegte
  User erhalten kein Passwort und können bis zu einem zukünftigen
  Invite-Flow nicht einloggen (bewusst dokumentierte Lücke, siehe
  README).
- **Login-Rate-Limiting ist In-Memory und pro Prozessinstanz.** Bei
  horizontaler Skalierung (mehrere API-Instanzen ohne geteilten Store)
  gilt das Limit effektiv pro Instanz, nicht global. Für den aktuellen
  Single-Instance-MVP-Betrieb unkritisch; später auf einen gemeinsamen
  Store (z. B. Redis) umstellbar, ohne die Guard-Anwendung auf
  `POST /auth/login` zu ändern.
- **Keine Anbindung sensibler externer Connectoren in diesem Sprint.**
  JWT-Einführung allein ist keine pauschale Freigabe für Gmail/Calendar/
  CRM/ERP-Adapter — jede solche Anbindung braucht eine eigene Bewertung
  der oben genannten Risiken.
  der oben genannten Risiken.
