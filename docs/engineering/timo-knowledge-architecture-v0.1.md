---
record_type: architecture-note
record_id: TIMO-KNOW-001
title: "TIMO Knowledge Architecture v0.1"
system: vito-platform
subsystem: timo-knowledge
status: PROPOSED
created: 2026-08-26
updated: 2026-08-26
author: VITO Engineering
baseline:
  branch: main
  sha: "cc0250278b3265caa8ad4b789a1f9091255fdefe"
---

# TIMO Knowledge Architecture v0.1

## Objective

Build a curated, versioned and auditable knowledge base for TIMO focused initially on German care, long-term-care insurance and ATERIMA operations. The knowledge layer must prefer authoritative primary sources over generic web content and remain reusable as a domain pack for the broader AOE/VITO ecosystem.

## Source hierarchy

### Tier A — normative primary sources

Primary legal sources are authoritative and override summaries or secondary commentary when conflicts occur.

Initial scope:

- SGB XI — Soziale Pflegeversicherung
- SGB V — Krankenversicherung / häusliche Krankenpflege where relevant
- SGB XII — Hilfe zur Pflege / Sozialhilfe where relevant
- Pflegezeitgesetz (PflegeZG)
- Familienpflegezeitgesetz where relevant
- Wohn- und Betreuungsvertragsgesetz (WBVG)
- Other directly relevant federal rules added only when TIMO use cases require them

### Tier A/B — authoritative implementation and guidance sources

- Bundesministerium für Gesundheit (BMG)
- GKV-Spitzenverband
- Medizinischer Dienst
- Official Pflegekassen / public authorities where needed

These sources are preferred for operational interpretation, benefit tables, assessment guidance, forms, procedures and current implementation details.

### Tier B/C — vetted practice sources

Use only for practical explanation, examples and workflow support, not as normative authority:

- Verbraucherzentrale
- Pflegestützpunkte
- recognized professional associations
- reputable care portals
- municipal/public advisory sources

If a practice source conflicts with a normative primary source, the primary source wins.

## Separate company knowledge layer

ATERIMA company knowledge must be kept distinct from general law and public care knowledge.

Initial ATERIMA layer:

- service model
- products / care models
- prices and cost structures
- contract / onboarding processes
- regions and availability
- FAQs
- objection handling
- customer conversation guides
- franchise / partner information where applicable
- CRM rules
- internal escalation paths
- current internal policies and process instructions

Company knowledge must never be presented as statutory law.

## Suggested logical structure

```text
TIMO KNOWLEDGE
|
|-- 01_LAW
|   |-- SGB_XI
|   |-- SGB_V
|   |-- SGB_XII
|   |-- PflegeZG
|   `-- WBVG
|
|-- 02_REGULATION_GUIDELINES
|   |-- BMG
|   |-- GKV
|   `-- Medizinischer_Dienst
|
|-- 03_BENEFITS
|   |-- Pflegegrade
|   |-- Pflegegeld
|   |-- Sachleistungen
|   |-- Verhinderungspflege
|   |-- Kurzzeitpflege
|   `-- Entlastungsleistungen
|
|-- 04_CARE_PATHWAYS
|   |-- Pflegegrad_beantragen
|   |-- Begutachtung
|   |-- Widerspruch
|   `-- Pflegeberatung
|
|-- 05_CARE_MODELS
|   |-- ambulant
|   |-- stationaer
|   |-- Tagespflege
|   |-- Wohngruppen
|   `-- Betreuung_zu_Hause
|
|-- 06_ATERIMA
|   |-- Produkte
|   |-- Prozesse
|   |-- Preise
|   |-- FAQ
|   `-- CRM
|
`-- 07_CASE_KNOWLEDGE
    |-- anonymisierte_Faelle
    |-- typische_Fragen
    `-- Lessons_Learned
```

## Knowledge pipeline

The pipeline should not be TIMO-specific. It should be a reusable AOE/VITO domain-knowledge pipeline:

```text
official sources
  -> automated retrieval
  -> source validation
  -> versioning
  -> parsing
  -> chunking
  -> metadata enrichment
  -> knowledge store
  -> governed retrieval
  -> TIMO
```

Target architecture:

```text
AOE Knowledge Engine
  -> Domain Pack: DE_PFLEGE
  -> TIMO
```

The same mechanism should later support other domain packs without rebuilding the ingestion stack.

## Required metadata per knowledge item

At minimum:

- source
- source_url
- authority_level
- document_title
- section / paragraph / article where applicable
- jurisdiction
- topic
- valid_from
- valid_until where available
- retrieved_at
- source_version / document_version where available
- supersedes
- superseded_by where known
- review_status
- content_hash

Legal and benefit-related statements should remain traceable to the exact source and validity period.

## Temporal correctness

Amounts, eligibility thresholds, benefits and legal interpretations must not be hardcoded indefinitely into prompts.

The knowledge layer must distinguish:

- current
- historical
- planned / announced
- superseded
- unknown validity

A current answer must not be inferred from a historical source without explicit validation.

## Retrieval policy

TIMO should answer from the curated knowledge base first.

When the curated base cannot support a material statement:

1. state that the knowledge base does not currently establish the answer;
2. retrieve from approved authoritative sources where live research is allowed;
3. preserve the source and date;
4. route uncertain legal/financial/medical edge cases to human review where required.

TIMO must not manufacture care grades, legal entitlements, benefit amounts or binding legal conclusions from incomplete evidence.

## Initial implementation scope

Start with approximately 10–20 highly authoritative sources, not thousands of webpages.

Priority order:

1. SGB XI
2. BMG Pflege online guidance and current benefit overview
3. GKV-Spitzenverband relevant Pflegeversicherung guidelines
4. Medizinischer Dienst Pflegebegutachtung guidance
5. SGB V / SGB XII sections required by real TIMO use cases
6. PflegeZG / WBVG where relevant
7. ATERIMA internal knowledge
8. vetted practical sources only for gaps and explanatory support

The objective is broad coverage of typical TIMO first-contact questions with high source quality and maintainable update effort.

## Strategic invariant

TIMO is a consumer of governed domain knowledge, not the owner of a one-off knowledge silo.

The reusable asset is the knowledge pipeline and `DE_PFLEGE` domain pack. TIMO is the first productive consumer.
