# VITO-EO-01 — Fake Provider Test Harness Specification v0.1

Status: Prepared test architecture

## Goal

Test VITO routing, retry, assurance and recovery deterministically before connecting real cloud/local model providers.

## Harness contract

A FakeProvider implements the same normalized provider adapter interface planned for EO-01.5.

Configurable scripted outcomes:
- SUCCEEDED
- FAILED
- TIMED_OUT
- QUOTA_BLOCKED
- POLICY_BLOCKED
- CANCELLED
- malformed structured output
- late response after timeout
- deterministic ReviewVerdict A/B/C/D
- reviewer disagreement fixtures
- configurable latency
- configurable token/cost usage

## Script example

Provider fake-a:
1. CODE_BUILD -> SUCCEEDED + PATCH artifact
2. RED_TEAM -> QUOTA_BLOCKED

Provider fake-b:
1. RED_TEAM -> SUCCEEDED + verdict C

Expected runtime behavior:
- fake-a build accepted
- quota event does not increment correction loop
- router selects eligible fake-b for RED_TEAM
- verdict C enters CORRECTION

## Determinism

No random failures by default. Test scenario explicitly declares execution sequence and outputs. Optional seeded chaos mode may come later.

## Safety

FakeProvider must not:
- access external network
- mutate Git repository unless isolated fake fixture explicitly tests policy layer
- read HOME/secrets
- bypass permission contracts

## Required scenarios

- preferred provider success
- preferred provider quota -> fallback
- timeout -> provider retry/fallback
- all providers unavailable -> NO_ELIGIBLE_PROVIDER
- AL4 two independent fake model families -> proceed
- AL4 same family -> blocked
- A/C reviewer disagreement -> blocked
- malformed verdict -> blocked/invalid artifact outcome
- correction loop reaches 3 -> human gate/block
- late stale response ignored
- budget exceeded before next execution -> blocked

## Implementation timing

Build as part of EO-01.3/01.5 test infrastructure before productive provider adapters are allowed to execute.
