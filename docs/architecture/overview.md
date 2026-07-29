# Architekturübersicht

## Module

```
AppModule
├── CommonModule (global)      – TenantContext, Roles-/Public-Decorators, RolesGuard
├── PrismaModule (global)      – PrismaService (DB-Zugriff)
├── AuthModule                  – Login, JwtStrategy, JwtAuthGuard (global), RolesGuard (global)
├── HealthModule                – GET /health (öffentlich)
├── OrganizationsModule         – Organizations CRUD (Tenant-Root)
├── UsersModule                 – Users innerhalb einer Organization
├── DigitalEmployeesModule      – DigitalEmployees innerhalb einer Organization
├── CapabilitiesModule          – Capabilities + Grant/Revoke an DigitalEmployees
├── TasksModule                 – Tasks, Zuweisung an User/DigitalEmployee
└── AuditModule                 – zentrale, wiederverwendbare Audit-Logik
```

## Request-Fluss (seit Sprint 2)

1. Der global registrierte `JwtAuthGuard` (aus `AuthModule`, via
   `APP_GUARD`) läuft vor jedem Request.
   - `@Public()`-Routen (`GET /health`, `POST /auth/login`) werden ohne
     Prüfung durchgelassen.
   - Ist ein `Authorization: Bearer <jwt>`-Header vorhanden, wird das JWT
     über Passports `JwtStrategy` verifiziert (Signatur, Ablauf), und
     `JwtStrategy.validate()` prüft zusätzlich pro Request gegen die
     Datenbank, dass User und Organization existieren und `ACTIVE` sind
     (siehe ADR-003, Abschnitt „Tenant-Sicherheitsprüfung“). Bei Erfolg
     befüllt der Guard den request-scoped `TenantContext` ausschließlich
     aus dem Token (`organizationId`, `userId`, `role`,
     `authenticationMethod: 'jwt'`).
   - Ist kein `Authorization`-Header vorhanden, greift nur bei
     `ALLOW_INSECURE_TENANT_HEADER=true` ein eng begrenzter
     Development-Fallback auf `X-Organization-Id` (`role: null`,
     `authenticationMethod: 'insecure-header'`). Andernfalls `401`.
2. Der ebenfalls global registrierte `RolesGuard` prüft, falls der
   Handler mit `@Roles(...)` versehen ist, ob `TenantContext.getRole()`
   in der erlaubten Liste enthalten ist (`403` sonst). Ohne
   `@Roles(...)` reicht Authentifizierung allein.
3. Controller lesen `organizationId` (und ggf. `userId`/`role` über
   `@CurrentUser()`) aus `TenantContext` und delegieren an den
   zuständigen Service. Controller enthalten keine Businesslogik.
4. Services kapseln Geschäftsregeln (z. B. Eindeutigkeit von `code`,
   Zuweisungsregeln bei Tasks) und filtern jede Query nach
   `organizationId`.
5. Audit-relevante Services injizieren `AuditService` und schreiben
   AuditEvents innerhalb derselben Datenbank-Transaktion wie die
   eigentliche Änderung.
6. Ein globaler `HttpExceptionFilter` vereinheitlicht alle Fehlerantworten.

Es gibt seit Sprint 2 **keine `TenantMiddleware` mehr** — ihre Aufgabe
(Tenant-Kontext befüllen) wurde vollständig von `JwtAuthGuard`
übernommen.

## Mandantentrennung

Jede Tabelle mit Organisationsbezug besitzt `organizationId`. Sämtliche
Lese-/Schreiboperationen filtern zusätzlich zur ID immer nach
`organizationId`, die ausschließlich aus dem verifizierten JWT stammt
(nie aus einem client-gesteuerten Header, solange ein Token vorhanden
ist). Ein Zugriff auf eine fremde Organization liefert `404` (Existenz
wird nicht preisgegeben).

## Autorisierung (RBAC)

Siehe README „Autorisierung (Rollenmodell)“ für die vollständige Tabelle.
Durchsetzung über `@Roles(...)`-Decorator (Metadaten) + `RolesGuard`
(liest `TenantContext.getRole()`). Bewusst keine komplexe Permission
Engine — vier feste Rollen (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`), keine
rollenspezifischen Sonderfälle pro Ressource jenseits dessen, was in der
README-Tabelle steht.

## Authentifizierung im Detail

Siehe `docs/adr/003-jwt-tenant-context-and-mvp-authorization.md` für:
Trust Boundary, Token-Claims, Rollenmodell, die Development-Header-
Ausnahme, die gewählte Token-Invalidierungsstrategie und verbleibende
Risiken.

## Bewusst nicht enthalten (aktueller Sprint)

- Microservices, Kubernetes, Kafka, Temporal, GraphQL, MCP
- ERPNext-/Odoo-/CRM-spezifische Datenmodelle
- Externe KI-Modelle
- Refresh-Tokens, Logout/Blacklisting, Passwort-Reset, Self-Service-
  Registrierung, Invite-Flow (siehe README „Empfehlungen für den
  nächsten Sprint“)
- Platform-Admin-Rolle für `POST /organizations`
