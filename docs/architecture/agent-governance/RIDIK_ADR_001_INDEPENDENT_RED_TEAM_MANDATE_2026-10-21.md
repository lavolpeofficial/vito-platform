# VITO OS – RIDIK | ADR-001: Unabhängiges Red Team und Mandat

**Datum:** 2026-10-21  
**Status:** Architekturentscheidung / Planungsgrundlage; NICHT implementiert  
**Geltung:** VITO, BOB, RICCARDO und künftige SPECIALIST-Agenten einschließlich DOROTHEA  
**Leitsatz RIDIK:** „Er sieht, was andere übersehen.“

## Verbindliche Rollen

- **VITO:** Orchestrierung, Aufgaben, Governance, Berechtigungen, Budget, Audit und Owner-Gates.
- **BOB:** Softwareentwicklung, Builds, Tests, begrenzte Fehlerkorrektur innerhalb vorab genehmigter Mandate.
- **RIDIK:** vom zu prüfenden Agenten unabhängiger Red-Team-Reviewer; getrennte Identität, Kontext und Zugriff.
- **RICCARDO:** Recherche, technische Analyse, Quellenbewertung und Wissensaufbereitung; keine autonome Ausführung aus fremden Vorschlägen.
- **DOROTHEA:** ADOREN-Fachspezialistin; ausschließlich kontrollierte Vorschläge; kein allgemeiner Softwareauditor.

RIDIK ist eine Rolle innerhalb der vorhandenen VITO-Agenteninfrastruktur und keine zusätzliche Plattform.

## Vorgeschlagenes Pilotmandat (keine Freigabe zur Ausführung)

| Parameter | Wert |
|---|---|
| Max. Korrekturzyklen von BOB | **2** (Initialimplementierung zählt nicht mit) |
| Externe KI-Ausgaben | **0 EUR** |
| Modus | **Offline / deterministische Simulation**, keine echten Provider-Aufrufe |
| Merge | **Nur explizite Owner-Freigabe** |
| Deployment | **Separate explizite Owner-Freigabe** |
| Produktionsdatenbanken/Live-Secrets | Verboten |
| Projektänderungen außerhalb isoliertem Workspace | Verboten |
| RIDIK-Findings | Append-only Originalbefunde; BOB darf nicht ändern oder löschen |
| Kosten-/Rechte-/Ressourcenverletzung | Default-Deny / Kill Switch / Eskalation |

Vor technischer Ausführung sind Mandat-ID, Tenant, Quellrevision, zugelassene Pfade und Befehle, Laufzeit-/Ressourcenobergrenzen, Gültigkeit, Owner-Approval und Reviewer-Identität nachzuweisen.

## Unabhängigkeits- und Sicherheitsregeln

1. **BOB ist kein eigener abschließender Prüfer.** RIDIK erhält eingefrorene, SHA-256-gebundene Artefakte und prüft mit einem vom BOB-Kontext getrennten Prüfkontext.
2. **RIDIK darf den geprüften Patch nicht verändern** und keine eigenen negativen Findings löschen. Korrektur und Neuprüfung werden als neue Ereignisse protokolliert.
3. **VITO kann koordinieren, darf aber keine RIDIK-PASS-Belege erfinden oder Findings überschreiben.** Evidenz muss über getrennte Rechte und möglichst extern gesicherte Prüfsummen geschützt werden.
4. Audit-Ereignisse in PostgreSQL sind noch kein Beweis manipulationsgeschützter Archivierung; die Schutzgrenze gegenüber privilegierten Infrastrukturakteuren muss separat bewertet werden.
5. **Deterministische Prüfungen vor KI-Aufrufen.** Reale Provider-Kostenlimits sind produktiv noch nicht nachgewiesen. Für den Offline-Pilot werden Provider-Aufrufe technisch verboten.
6. Owner-Gates für Mandatserweiterung, Hochrisiko-Rechte, Merge und Deployment bleiben explizit und voneinander getrennt.

## Geplante Phasen

**G1** BOB-Workflow mit echter isolierter PostgreSQL-Persistenz, Audit, Replay und Wiederanlauf nachweisen.  
**G2** Technisch durchgesetztes ExecutionMandate auf vorhandenen Workflow-/Identity-/Governance-Diensten.  
**G3** Deterministischer isolierter BOB-Entwicklungsworker mit begrenzten Korrekturen.  
**G4** RIDIK als unabhängig prüfende VITO-Rolle mit Negativtests und geschützten Findings.  
**G5** Vollständiger Offline-Pilot: Aufgabenannahme → Patch → Tests → RIDIK-FAIL → BOB-Korrektur → RIDIK-PASS → Owner-Handoff.

Ein Simulations-PASS ist **nicht** gleichbedeutend mit echter KI-autonomer Entwicklungsfähigkeit.

## Stand der Nachweise zum Zeitpunkt der Entscheidung

R341-R2: 245/245 Unit, 40/40 PostgreSQL und 19 Authentifizierungsfälle laut Abnahme.  
R342: H1 11/11, H3 7/7, H4 15/15, B1a 11/11, B1 10/10, B2 12/12 und H5 15/15; H2 Contracts/API-Build bestanden.  
Offen: vollständiges VITO AppModule, real persistierter BOB-Governance-Lebenszyklus, technische RIDIK-Integration, reale Provider-Ausgabenobergrenze, Origin-Policy.

**Freigabe:** ARCHITECTURE_ONLY. Registrierung, Aktivierung, Merge und Deployment: NO_GO.
