---
record_type: acceptance-evidence
record_id: VITO-OB-002D-FLIGHT-001-RERUN
title: "Operator Bridge v0.2D — Flight 001 Rerun Acceptance Evidence"
system: vito-platform
subsystem: operator-bridge / governed-runtime / cloud-governed-execution
status: PASS
created: 2026-08-29
author: VITO Engineering
related_branch: feat/vito-operator-bridge-v0.2d-governed-cloud-execution-tier
flight_head: "64ce45f2acc34500525f308bb5249bf757e3f9bb"
supersedes: VITO-OB-002D-FLIGHT-001
finding_resolution: "OB002D-MEDIUM-PROVIDER-IDENTITY CLOSED at 64ce45f2acc34500525f308bb5249bf757e3f9bb"
merge_gate: CLEARED
---

# VITO Operator Bridge v0.2D — Flight 001 Rerun Acceptance Evidence

## 1. Verdict

**Flight 001 — adapter-boundary acceptance: PASS (accepted).**

Re-run against the exact flight HEAD after the provider-identity hardening
correction. The real governed cloud execution path completed successfully
through the authorized OpenAI provider, the exact canonical proof mutation was
captured, all teardown/isolation postconditions held, and the
OB002D-MEDIUM-PROVIDER-IDENTITY postcondition was enforced and passed.

## 2. Sanitized acceptance evidence

| Criterion | Evidence | Result |
|-----------|----------|--------|
| Head flown | `64ce45f2acc34500525f308bb5249bf757e3f9bb` | PASS |
| Result status | `SUCCEEDED` through the cloud-governed adapter boundary | PASS |
| Agent exit code | `0` | PASS |
| Repository / base governance | `lavolpeofficial/vito-platform`, base `main`, `baseSha=b5abe3f8e3b105a2db28b307a29990135e795729` | PASS |
| Change-set | exactly one file: `docs/vito-flight-001-proof.md`; no unrelated mutations | PASS |
| Patch size | `patchBytes=383`, `settlingEmpty=false` | PASS |
| Canonical proof hash | `actualSha256 = c332bc62e9b11036400b2006eb6215dd773c175ce0d4736b19a6bae6928811b0 = expectedSha256` | PASS |
| Flight 001 acceptance | `checked=true, passed=true` | PASS |
| Provider-identity postcondition | `enforced=true, passed=true` | PASS |
| Expected provider | `expectedProviderId=openai` | PASS |
| Observed provider | `observedProviderId=openai` | PASS |
| Observed model vs server-owned model policy | `observedModelId=gpt-5.6-terra-fast` satisfied the configured `allowedModelIds` allow-list | PASS |
| Credential teardown | `credentialDisposition=removed`; no credential values ever present in evidence | PASS |
| Session teardown | `workspaceDisposition=CLEANED`; zero residual files/processes after the run | PASS |
| Post-flight gates | API suite 665 passed (11 skipped); contracts 263/263; build clean; tree clean | PASS |

## 3. Provider/model identity evidence (sanitized, machine-readable)

The launcher's own log lines were parsed by the boundary — only sanitized,
strict-charset-validated provider/model identifiers were exposed. No
credential material, opaque references, or paths to sensitive material appear
in evidence.

- Authorized run (server-owned profile `expectedProviderId=openai`):
  `providerID=openai modelID=gpt-5.6-terra-fast` — accepted.
- Negative fallback proof: a drained session (no governed credential) ran the
  embedded fallback identity `providerID=opencode modelID=big-pickle`; with an
  OpenAI-authorized profile the boundary failed closed with
  `PROVIDER_IDENTITY_MISMATCH`. The embedded fallback is never disabled or
  mutated globally; VITO simply refuses to accept execution through an
  unauthorized provider identity.

## 4. Merge gate

- Delta review: PASS.
- Provider-identity hardening finding: CLOSED.
- Flight 001 rerun acceptance: PASS.
- Complete pre-PR gates re-run from the clean branch: green.

**Ready for PR.** No merge performed; `main` unmodified.