# ADR-008 — VITO EO Provider Health Persistence

Status: Accepted for EO-01 v0.1

## Decision

Provider registry persists current normalized health/quota state and last-known evidence metadata. Active probing is not required for the first router; execution feedback and explicit configuration may update state.

## Health states

UNKNOWN, HEALTHY, DEGRADED, QUOTA_LIMITED, UNAVAILABLE, DISABLED.

## Principles

- UNKNOWN is not equivalent to HEALTHY
- DISABLED is administrative and not auto-recovered
- quota state is distinct from generic health
- provider failure does not equal workflow failure
- stale health evidence must be timestamped

## Revisit when

Active probes, circuit breakers, distributed workers or provider SLAs are introduced.
