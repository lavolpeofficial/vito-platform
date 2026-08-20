# ADR-010 — VITO EO Local Reviewer Class

Status: Accepted architectural direction

## Decision

Local LLM reviewers are first-class provider candidates for review capabilities, but locality alone does not establish reviewer independence or assurance quality.

## Principles

- RED_TEAM is a capability, not a Claude-specific function
- provider classes may include CLOUD_LLM, LOCAL_LLM and DETERMINISTIC_TOOL
- AL4 independence is evaluated by actual execution evidence and model-family/provider metadata
- local reviewer may provide resilience when cloud quota/availability fails
- deterministic tooling may complement but not automatically replace required independent model review

## Non-decision

No specific local model/runtime is fixed in EO-01 architecture. Selection follows hardware/capability testing later.
