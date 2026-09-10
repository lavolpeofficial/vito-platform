# VITO Self-Learning Core v1

## Purpose

VITO learns at the system level from governed execution experience. The loop is:

`Observe → Act → Measure Outcome → Reflect → Learn → Retrieve → Improve`

This is not foundation-model training, fine-tuning, reinforcement learning, autonomous source-code modification, or ungoverned policy mutation.

## Architectural placement

The learning core remains inside the existing VITO NestJS modular monolith and PostgreSQL persistence layer. It reuses the established tenant context and audit service. No new microservice or vector database is introduced.

Role boundary:

- AOE: intelligence, reasoning and understanding of the decision maker.
- OSSERVATORE: external decision intelligence and understanding of the decision space.
- VITO: orchestration, governed execution, observation, outcome measurement and organizational learning.

## Phase 1 · Experience Store

An Experience captures:

- organization and digital employee identity
- goal and execution context
- observation
- decision
- action
- result
- optional success score (`-1..1`)
- optional confidence (`0..1`)
- optional feedback
- optional lesson
- optional reusable pattern
- lifecycle status and timestamps

All repository operations are scoped by `organizationId`. Recording also verifies that the referenced digital employee belongs to the authenticated organization. Cross-tenant access fails closed. A `LEARNING_EXPERIENCE_RECORDED` audit event is emitted for every accepted record.

The score is stored evidence only. It does not by itself modify future behavior or promote a policy.

## Lifecycle boundary

Phase 1 allows storage states `OBSERVED`, `EVALUATED`, `REFLECTED`, `LEARNING_CANDIDATE`, and `ARCHIVED`, but only establishes persistence. Later phases own the transitions and their governance rules.

Planned learning maturity is separate from storage status:

`OBSERVATION → HYPOTHESIS → PATTERN → POLICY`

Promotion must be evidence-backed, traceable and reversible. No automatic promotion is authorized by Phase 1.

## Persistence note

The first Experience Store implementation uses parameterized Prisma raw SQL against the migration-created `experiences` table. This avoids coupling the learning-domain contract to generated Prisma model APIs while the module boundary is established. The table follows the repository's existing TEXT identifier contract and keeps explicit database checks for score, confidence and lifecycle status.

## Next phases

1. Outcome/Evaluation: link objective outcome evidence to an Experience.
2. Reflection: derive structured lessons from evidence and outcome, never from self-assessment alone.
3. Governed learning candidates and maturity promotion.
4. Failure-pattern persistence.
5. PostgreSQL-first retrieval for later runs.
6. Skill foundation without autonomous skill generation.

The core is intentionally model-agnostic: LLM providers may be replaced without changing the durable learning contract.
