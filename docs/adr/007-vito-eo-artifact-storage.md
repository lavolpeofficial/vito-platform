# ADR-007 — VITO EO Artifact Storage

Status: Accepted direction for EO-01 v0.1

## Decision

ExecutionArtifact is persisted as metadata + immutable content reference/hash. Large artifact bytes do not need to live in PostgreSQL. Storage backend remains replaceable.

## Rationale

- artifacts may be large (logs, diffs, review packages)
- immutability and provenance matter more than relational storage of bytes
- allows local filesystem initially and object storage later

## Invariants

- accepted artifact reference is immutable
- SHA-256 or equivalent integrity hash required
- producer execution/system actor recorded
- tenant/workflow/step lineage recorded
- content replacement creates a new artifact identity

## Revisit when

Retention, encryption, object-lock, legal hold or distributed storage requirements become concrete.
