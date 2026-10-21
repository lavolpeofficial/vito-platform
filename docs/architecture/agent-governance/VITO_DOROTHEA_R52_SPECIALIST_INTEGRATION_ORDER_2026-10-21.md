# VITO OS – DOROTHEA R5.2 | Source-only Integrationsauftrag

**Datum:** 2026-10-21  
**Status:** GEPLANT / NICHT IMPLEMENTIERT  
**Priorität:** Nach VITO–BOB-Governance; DOROTHEA-Intake als kleiner, isolierter Erweiterungspfad  
**Keine Erlaubnis für:** Registrierung, Aktivierung, Merge, Deployment, echte Delegation, externe Provider-Kosten, produktive Datenbanken oder Änderungen an R312, Golden oder bestehenden Worktrees.

## A. Verifizierter Ausgangspunkt und Grenzen

Die übergebenen R5.2-Artefakte dokumentieren einen **statischen** Abgleich von 15 VITO-Quellpositionen (G01–G15) mit dem geschützten FSN1-HEAD `a4a376bb229ab3eaf2eeb76a6c8cfc4048b1845d`; 13 bereits vorhandene unstaged Änderungen, 0 staged und gepinnte Core-Hashes blieben laut Probe unverändert. Sie dokumentieren **keine** neue Runtime-, Auth-, RLS-, DB- oder Dispatch-Abnahme. Die 20/20 Offline-Vertragstests wurden in der Übergabe berichtet; die fünf beigefügten Dateien enthalten keinen vollständigen Roh-Jest-Lauf als unabhängige Nachprüfung.

R5.1-Handoff: Schema `dorothea.vito.offline-handoff/0.1.0`; Digest `52e03b3d8cb46854007b0b1d3870cc6bd61855b3cc4cdf1a99829503b6e34816`; Mission-SHA `ff3ed1966a8460276dafc7b93a582fb49d26fdaf27e30b1a85cebbb9da6de1ec`; Source-Commit `2abfddcea81637923a4ec5309dc1410fbeedf9c3`; Vorschläge `DOR-50-01`, `DOR-50-02`, `DOR-50-03`. Laut Summary gilt `identityBound=false`, `executionAuthorized=false`, `registration=NO_GO`, `deploy=NO_GO`.

R342-Abgleich aus vorangegangenen Abnahmen: Auth-JWT, Tenant-Trennung, echte lokale HTTP/PostgreSQL-Teilstrecke, BOB-Guards und isolierter BOB-Service wurden getestet. **Nicht** nachgewiesen sind ein produktiver DOROTHEA-Intake, DB-RLS und atomare DOROTHEA-Idempotenz, vollständige AppModule-Integration, eigenständige DOROTHEA-Ausführungsrechte oder erlaubte RICCARDO/BOB-Delegation. RICCARDO R312-Dienstmetadaten sind kein funktionaler Health-/Releasenachweis.

## B. Integrationsgrundsatz

DOROTHEA ist ein **SPECIALIST mit ausschließlich kontrollierten Vorschlagsrechten** im bestehenden VITO-System. Ein Vorschlag ist weder Aufgabe noch AgentSpec noch Capability-Grant noch Delegation noch Aktivierungsanweisung. DOROTHEA enthält keine Autorität über Tenant, Owner, Agentenstatus, Rollen, Enabled-Flags, Workflows, Merge, Deployment oder Budget.

**Minimaler Datenweg (zunächst nur Soll-Architektur):**

1. Untrusted `R5.1 Offline-Handoff` → strikt versionierter, begrenzter serverseitiger Intake-Adapter.
2. Server prüft erlaubtes Schema, höchstens drei Vorschläge, Größe/Zeichensatz, Quellen-Digest, Mission-Digest, Source-Commit, Nonce und dokumentierte Provenienz. Digestwerte sind Integritätshinweise, **keine** Authentifizierung oder Freigabe.
3. VITO löst **Tenant, Actor, Membership, Rolle und Owner-Zuordnung ausschließlich aus verifizierter Session/JWT und Datenbank** auf; keine Autorisierungsfelder aus Handoff übernehmen.
4. Persistiere nur einen **PENDING_PROPOSAL** samt Original-Digest, serverseitiger Operation-ID, Absender-/Scope-Metadaten und Audit in **derselben DB-Transaktion**, wenn spätere DB-Phase ausdrücklich freigegeben wird. Kein `isEnabled=true`.
5. Owner prüft und genehmigt oder verwirft jeden Vorschlag separat; Annahme eines Vorschlags ist nicht dasselbe wie Genehmigung der Ausführung.
6. RICCARDO-Recherche und BOB-Engineering benötigen später **eigene** Mandate, Capability-/Status-Prüfung und separate Owner-Gates. Keine automatische Weiterleitung aus dem Handoff.

Es wird kein zweites Agenten-, Tasks-, Workflow-, Audit- oder Idempotenzsystem geschaffen. Wiederverwendung der bestehenden VITO-Module ist verbindlich, soweit deren tatsächliche Laufzeit-Sicherheit separat nachgewiesen ist.

## C. Kompatibilitätsmatrix zu konkreten Arbeitsbausteinen

| Gate | Wiederverwendbarer Quell-Anker / aktueller Befund | Minimal notwendiger Baustein / Owner | Nachweis |
|---|---|---|---|
| G01 AgentSpec | `agent-spec.validator.ts` vorhanden; Offline-Handoff ist **kein** AgentSpec | VITO API: eigenes versioniertes, strikt validiertes Intake-DTO | Fremde Felder/Versionen/Übergröße → 4xx, keine Mutation |
| G02 CapabilityCatalog | `bob.policy.ts`; `tasks.suggest` im Katalog | VITO Policy: `tasks.suggest` default disabled, kein impliziter Grant | Capability aus Katalog allein → DENY |
| G03 AgentBuilder | Bestehender Preview-/Provision-Pfad | BOB/VITO: DOROTHEA zunächst nur Proposal, keine Agent-Registrierung | `registration=NO_GO`; keine neue Agent-ID |
| G04 StagingRoute | Feste BOB-Stagingroute gefunden | BOB/VITO: agentenspezifischer Artefaktprüfer **später**, BOB-Verhalten unverändert | BOB-Regression, fremdes Artefakt → DENY |
| G05 CapabilityGrant | `capabilities.service.ts` akzeptiert explizites Enable-DTO | Auth/Policy: serverseitiger Owner-Gate vor `isEnabled=true` | DOROTHEA-JSON `isEnabled:true` → niemals aktiv |
| G06 WorkflowIdentity | `workflow-execution-identity.service.ts` vorhanden | VITO Runtime: ACTIVE-Status + Grant + Scope **bei jedem Dispatch** | DRAFT/PAUSED/SUSPENDED → DENY |
| G07 WorkflowPlan | `workflow-execution-plan.service.ts` vorhanden | VITO Workflow: kein Engineering-Step aus Proposal ohne eigenes Mandat | Proposal ≠ Workflow-Execution |
| G08 HumanApproval | `workflow-agent-assignment.service.ts` vorhanden | Auth/Owner: Owner/Tenant aus JWT + Membership, nie Payload | Fremder Tenant/Member → DENY |
| G09 Audit | `audit.service.ts` vorhanden | VITO Audit + DB: Proposal/Audit atomar, tenantgebunden | Rollback hinterlässt weder Proposal noch Audit |
| G10 Idempotenz | Nicht runtimegetestet | VITO DB: Unique `(tenant_id, operation_id)` und Request-Digest-Bindung | Parallelidentische Requests → genau eine Wirkung; Konfliktdigest → 409 |
| G11 RICCARDO/BOB | Workforce-Routing vorhanden; Dispatch nicht autorisiert | VITO: getrennte, vom Owner freigegebene Research-/Engineering-Aufträge | Kein Dispatch ohne separates Owner-Mandat |
| G12 Tenant/RLS | Statisch nicht nachgewiesen | VITO DB/Security: Session/JWT/Membership/RLS + Negativtests | Cross-Tenant Read/Write → DENY |
| G13 Provenance | R5.1 SHA/Digest bestätigt | VITO Intake: immutable, serverseitig überprüfter Herkunftsbeleg | Manipulierte Payload / falscher Digest → DENY |
| G14 AgentActivation | `digital-employees.service.ts` mit Aktivierungsgate | VITO Owner: spätere Aktivierung separat und explizit | Kein ACTIVE ohne getrennte Approval |
| G15 DOROTHEA Intake | In 15 geprüften Dateien nicht nachgewiesen | VITO API: kleiner Input-Adapter **statt neue Plattform** | Schema-Version, Umfang, Autorität und Audit geprüft |

**Keine Aussage über repo-weite Nichtexistenz** aus fehlendem Literal. Für G15 ist die konkrete Implementierung beim freigegebenen Source-only-Gate zu prüfen.

## D. Verantwortlichkeiten

| Verantwortlich | Konkrete Aufgabe | Ausschlüsse |
|---|---|---|
| **VITO / Systemarchitektur** | Kontrakt, Mandatsgrenzen, serverseitige Auth, Statusmaschine, Operation-ID, Owner-Gates, Releaseentscheidung | Keine automatische Registrierung/Aktivierung |
| **BOB / Engineering** | Nach späterer Freigabe minimalen DTO-/Adapter-Patch im isolierten Workspace erstellen und deterministische Tests ausführen | Kein Merge, Deployment oder aktivierte Capability |
| **RIDIK / unabhängiges Quality Gate** | Später eigener Negativtestkatalog: Payload-Manipulation, Cross-Tenant, Replay, Befundintegrität; separater Prüfkontext | Kein Code-Schreibrecht, kein Self-Approval |
| **RICCARDO / Research** | Spätere Quell-/Faktenprüfung nur nach separatem Owner-Auftrag; R312 bleibt unverändert | Keine Delegationsannahme aus DOROTHEA-Vorschlag |
| **DOROTHEA / ADOREN-Fachbereich** | Versionierten, nicht autoritativen Vorschlag mit Belegen liefern | Keine direkte Ausführung, Grant oder Owner-Behauptung |
| **Owner** | Separate Zustimmung je Mandat/Delegation/Agent-Registrierung und später Merge/Deployment | Keine stillschweigende Freigabe aus Tests |
| **AOE / Evidence Owner** | Die R5.1-Evidenz samt festem Digest dauerhaft als unveränderliche Referenz verfügbar machen | Keine automatische AOE-Wirksamkeitsbehauptung |

## E. Abhängigkeiten und priorisierte Gates

### D0 – Source-only Governance-Abgleich (JETZT; freigegeben für Prüfung)

Prüfe R5.2-Matrix, Source Pins und Wiederverwendung gegenüber R341/R342. Lege Kontraktentwurf, negative Testfälle, betroffene bestehende Module und Änderungsumfang fest. **Keine Änderungen** an Repository, DB, Registrierungen oder Diensten.

**Abnahme D0:** 15/15 Gap-Positionen klassifiziert; gefahrlose Integrationsgrenze definiert; Source-basierte Nachweise und Limits dokumentiert; `IMPLEMENTATION=NOT_AUTHORIZED`.

### D1 – Isoliertes DTO- und Policy-Gate (NUR NACH NEUER OWNER-FREIGABE)

BOB ergänzt kleinste notwendige Adapter-/Validierungslogik in unabhängiger Arbeitskopie. Keine reale Agentenaktivierung, keine Netzwerk- oder DB-Mutation. Testet Version, Größenlimit, drei Proposal-IDs, Nonce, Digest, Unknown Fields, keine Trusted Tenant-/Owner-Claims. Statische Analyse und Regression.

**Abnahme D1:** Positiv-/Negativtests bestehen; BOB- und RICCARDO-Quell-Pins unverändert; keine Disposition `isEnabled=true`, keine Ausführung.

### D2 – Separates isoliertes Runtime-/Service-Gate (NUR NACH OWNER-FREIGABE)

Echte lokale VITO-Session-/Guard-Tests mit synthetischem Tenant, OWNER, MEMBER und Fremd-Tenant. Prüfe Runtime-Zustand/Scope bei jedem potentiellen Dispatch. BOB-/RICCARDO-Delegation bleibt gesperrt.

**Abnahme D2:** Unauthorized, stale token, wrong role, wrong tenant, DRAFT/PAUSED/inactive agent, forged owner binding fail closed; kein bestehender R312-Dienst beeinflusst.

### D3 – Eigenes PostgreSQL-/RLS-/Audit-Gate (NUR NACH OWNER-FREIGABE)

Wegwerfbare lokale Testdatenbank, migrationsgebundene atomare Unique-Constraint, Transaktions-/Rollbacktests, zwei parallele Wiederholungen, Cross-Tenant-RLS. Keine produktive Datenbank.

**Abnahme D3:** Ein (Tenant, operationId) → maximal eine persistierte Proposal-Wirkung und ein zugehöriger Audit-Commit; anderes Payload bei gleicher operationId → Conflict; DB-Fehler → vollständiger Rollback; Tenant-Boundary auch auf DB-Ebene nachgewiesen.

### D4 – Getrennte Delegations- und Agentenfreigabe (SPÄTER, SEPARAT)

DOROTHEA darf nach ausdrücklicher Registrierung/Owner-Entscheidung die kontrollierte `tasks.suggest`-Capability erhalten. Annahme, Research, Engineering, Registrierung und Aktivierung sind **getrennte** Owner-Entscheidungen.

**Abnahme D4:** Proposal erzeugt niemals automatisch einen Agentenlauf, Enabled-Capability, Aufgabenplan, RICCARDO-Recherche oder BOB-Engineering. Unabhängige RIDIK-Negativprüfungen und Regressionen vor einem Release.

## F. Mindest-Negativtestkatalog für spätere Implementierung

- N01 falsche Schema-Version, N02 mehr als 3 Vorschläge, N03 unbekannte Proposal-ID oder Duplikat, N04 übergroßer Input, N05 gefälschter SHA/Source-Commit, N06 fehlende/falsche Nonce, N07 schädliches Payload mit angehängten Rollen oder `isEnabled=true`.
- N08 fehlende Session, N09 OWNER aus Payload, N10 MEMBER- oder Fremd-Tenant-Zugriff, N11 abgelaufenes/revoziertes JWT, N12 DRAFT/PAUSED/inaktive Identität als Dispatchquelle.
- N13 gleicher Request parallel, N14 gleiche Operation-ID mit anderem Digest, N15 DB-Commit-Fehler, N16 Audit-Commit-Fehler, N17 RLS-Cross-Tenant Read/Write.
- N18 DOROTHEA→RICCARDO ohne separate Freigabe, N19 DOROTHEA→BOB ohne separate Freigabe, N20 Agent-Aktivierung ohne Owner-Gate, N21 BOB-Routen-Regression, N22 RIDIK-Finding-Manipulation.

## G. Risiken und Kontrollen

**Technisch (hoch):** DTO-/AgentSpec-Verwechslung, Capability-Eskalation über Enabled-DTO, DRAFT-Dispatch, Replay, Race Condition, fehlende DB-RLS-Durchsetzung. Gegenmittel: strukturelle Typtrennung, Owner-/Tenant-Policy, atomare DB-Constraints, Negativtests.

**Rechtlich (hoch bei realen ADOREN-Daten):** Der Handoff kann später personen- oder gesundheitsbezogene Daten berühren. Für den Pilot nur synthetische Daten; vor Realbetrieb Rechtsgrundlage, Zweckbindung, Rollen, Aufbewahrung, Datenminimierung und ggf. DSGVO-Datenschutzfolgenabschätzung prüfen. Keine Übertragung sensibler Profile an BOB, RIDIK oder externe Provider ohne gesonderte Grundlage.

**Wirtschaftlich:** Kosten durch parallele Entwickler-/Reviewer-Läufe, unnötige Provider-Anfragen, Wartung duplizierter Module. Gegenmittel: vorhandene VITO-Dienste wiederverwenden, zentrale Budgetsperre, deterministische Offline-Gates zuerst, 0 EUR externe KI-Ausgaben bis Freigabe.

**Skalierung:** Tenant-übergreifende Kollisionen, wachsende Audit-Last, unkontrollierte Delegationsketten. Gegenmittel: `(tenant_id, operation_id)`-Eindeutigkeit, begrenzte Payload-Größe, eindeutige Reviewer-/Mandatsreferenzen und parallele Concurrency-Abnahme.

**Fachliche Validität:** 48 synthetische AOE-Fälle sind keine klinische, psychologische oder sonstige unabhängige Wirksamkeitsvalidierung; keine unbelegten Wirkungs- oder Prognosebehauptungen.

## H. Release- und Stoppregeln

- D0: Architektur-/Quellreview abgeschlossen; **nur Planung**.
- D1–D4: **nicht freigegeben**, jeweils gesondertes Owner-Gate.
- Bestehendes HEAD `a4a376bb229ab3eaf2eeb76a6c8cfc4048b1845d`, 13 vorhandene tracked Änderungen und Kern-Hashes schützen; vor jeder späteren Umsetzung verifizieren.
- R312-VITO/RICCARDO-Dienste und bestehende Kandidaten unangetastet.
- Keine Bezeichnung `PASS_RUNTIME` ohne entsprechende echte Testausführung.
- Registrierung, Aktivierung, Merge, Deployment und produktive Datenbankzugriffe: **NO_GO**.
- RIDIK ADR-001 bindet künftig die unabhängige Prüfebene; sie ist nicht Voraussetzung für die unveränderte D0-Dokumentation, aber eine geplante Freigabebedingung für D4.

## I. Entscheidungs- und Verantwortungsmatrix

| Entscheidung | DOROTHEA | VITO | BOB | RICCARDO | RIDIK | OWNER |
|---|---|---|---|---|---|---|
| Vorschlag erzeugen | Erstellt | Validiert (geplant) | – | – | – | – |
| Vorschlag annehmen | – | Prüft Recht/Scope | – | – | – | **Entscheidet** |
| Recherche delegieren | Kein Recht | Separate Mandatsprüfung | – | Nach Mandat | Spätere unabhängige QA | **Genehmigt** |
| Engineering delegieren | Kein Recht | Separate Mandatsprüfung | Nach Mandat | – | Spätere unabhängige QA | **Genehmigt** |
| Capability aktivieren | Kein Recht | Server-Gate | Kein Recht | Kein Recht | Kein Recht | **Explizite Freigabe** |
| Agent aktivieren | Kein Recht | Server-Gate | Kein Recht | Kein Recht | Kein Recht | **Explizite Freigabe** |
| Merge/Deployment | Kein Recht | Sperrt ohne Referenz | Kein Recht | Kein Recht | Prüft | **Separat genehmigt** |

## J. Quellen und Provenienz

- `R52_GOVERNANCE_GAPS.md`
- `R52_COMPATIBILITY_MATRIX.md` und `.json`, G01–G15
- `R52_FS1_SOURCE_PROBE.json`
- `R52_R51_VERIFIED_SUMMARY.json`
- Vorherige R341-/R342-Terminalabnahmen im VITO-Chat
- `RIDIK_ADR_001_INDEPENDENT_RED_TEAM_MANDATE_2026-10-21.md`

**Endstatus:** `D0_PLAN=READY_FOR_OWNER_REVIEW`; `IMPLEMENTATION=NOT_AUTHORIZED`; `REGISTRATION=NO_GO`; `ACTIVATION=NO_GO`; `MERGE=NO_GO`; `DEPLOY=NO_GO`.
