# ADR-002: Task-Assignment-Invariante zusätzlich per DB-CHECK-Constraint absichern

## Status
Akzeptiert

## Kontext
Eine Task darf zu jedem Zeitpunkt entweder `assignedUserId`,
`assignedDigitalEmployeeId` oder keine Zuweisung besitzen, niemals beide
gleichzeitig. Diese Regel wurde bereits in `TasksService` (Methode
`resolveAssignmentTarget`) auf Anwendungsebene durchgesetzt: Der bestehende
Task-Zustand wird geladen, mit den im PATCH-Body tatsächlich übergebenen
Feldern zum Zielzustand verrechnet, und erst dieser Zielzustand wird
validiert und automatisch bereinigt (Wechsel auf User löscht
`assignedDigitalEmployeeId` automatisch und umgekehrt).

Anwendungslogik allein schützt jedoch nicht vor:
- direkten SQL-Statements (z. B. durch spätere Batch-Jobs, Migrationen,
  manuelle Hotfixes),
- Bugs in zukünftigen Code-Änderungen, die diese Regel umgehen,
- konkurrierenden Schreibzugriffen außerhalb der aktuellen Transaktion.

## Entscheidung
Prisma (Version 5.x, ohne die hier genutzten Preview-Features) kann
Tabellen-CHECK-Constraints nicht direkt im `schema.prisma`-DSL ausdrücken.
Es gibt daher keinen Weg, diese Regel im Prisma-Schema selbst zu
deklarieren. Der Constraint wird stattdessen als **eigenständige, reguläre
Prisma-Migration** in der normalen Migrationshistorie geführt:

```
prisma/migrations/
├── migration_lock.toml
├── 20260725120000_init/
│   └── migration.sql                          -- vollständiges Basis-Schema
└── 20260725120100_task_assignment_xor_check/
    └── migration.sql                          -- CHECK-Constraint
```

`20260725120100_task_assignment_xor_check/migration.sql` enthält:

```sql
ALTER TABLE "tasks"
  ADD CONSTRAINT "task_assignment_xor_check"
  CHECK (
    "assignedUserId" IS NULL
    OR "assignedDigitalEmployeeId" IS NULL
  );
```

Da beide Migrationen im regulären `prisma/migrations`-Verzeichnis mit
korrektem Zeitstempel-Präfix liegen, wendet `prisma migrate deploy` (bzw.
`prisma migrate dev`) sie automatisch und in der richtigen Reihenfolge an
— **kein manueller Zusatzschritt** mehr nötig.

### Verifikation

In der Entwicklungs-Sandbox war der Download der Prisma-Query-/
Schema-Engine (`binaries.prisma.sh`) durch die Netzwerk-Policy blockiert,
weshalb die Migrationen nicht über die `prisma migrate`-CLI selbst erzeugt
werden konnten. Um trotzdem eine reale Prüfung zu erreichen, wurde:

1. das SQL beider `migration.sql`-Dateien deterministisch aus
   `prisma/schema.prisma` abgeleitet (Prisma-übliche Namens- und
   Strukturkonventionen: `CreateEnum`/`CreateTable`/`CreateIndex`/
   `AddForeignKey`, danach `AddCheckConstraint`),
2. beide Dateien nacheinander mit `psql` gegen eine frische, lokale
   PostgreSQL-16-Instanz ausgeführt — exakt in der Reihenfolge, in der
   `prisma migrate deploy` sie anwenden würde,
3. das Ergebnis geprüft: alle 7 Tabellen, alle Foreign-Key-Constraints und
   der CHECK-Constraint sind korrekt vorhanden (`\dt`, `\d tasks`),
4. funktional mit echten `INSERT`-Statements gegengeprüft: Task mit nur
   `assignedUserId`, Task mit nur `assignedDigitalEmployeeId` sowie „keine
   Zuweisung" wurden akzeptiert; ein `INSERT` mit beiden Feldern
   gleichzeitig wurde von PostgreSQL mit `violates check constraint
   "task_assignment_xor_check"` abgelehnt.

**Nicht verifiziert wurde:** der tatsächliche Lauf über die
`prisma migrate`-CLI (`prisma migrate dev`/`deploy`/`status`) selbst, da
diese ohne Netzwerkzugriff auf `binaries.prisma.sh` nicht startet. In
einer Umgebung mit normalem Internetzugang sollte einmalig
`prisma migrate status` gegen eine frische Datenbank ausgeführt werden, um
zu bestätigen, dass Prisma die beiden Migrationsdateien als konsistent mit
`schema.prisma` erkennt (`prisma migrate diff` sollte keine Abweichung
mehr melden).

## Konsequenzen
- Die Invariante ist auf zwei Ebenen abgesichert: Anwendungslogik (mit
  automatischem Auto-Clear-Verhalten, freundlichen 400-Fehlermeldungen)
  und Datenbank (harte, nicht umgehbare Garantie).
- Ein direkter SQL-`UPDATE`/`INSERT`, der beide Felder gleichzeitig setzt,
  schlägt auf DB-Ebene fehl, selbst wenn er die Anwendungsschicht umgeht.
- `pnpm prisma:migrate` / `pnpm prisma:migrate:deploy` wenden beide
  Migrationen automatisch an; es gibt keinen separaten Copy-&-Paste-Schritt
  mehr.
- Sollte Prisma in einer späteren Version natives CHECK-Constraint-Tooling
  im Schema anbieten, kann `schema.prisma` entsprechend ergänzt und beim
  nächsten `prisma migrate dev` eine (leere) Folge-Migration erzeugt
  werden; die bestehende Migrationshistorie bleibt davon unberührt.
