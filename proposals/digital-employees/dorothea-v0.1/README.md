# DOROTHEA 0.1 — Source-only VITO Specialist Proposal

**Owner intent:** DOROTHEA works with VITO and keeps ADOREN's orientation intelligence fit, safe and improving.

**Current stage:** `DRAFT/PROPOSAL`; NOT a real registered AgentSpec or employee; NOT dispatched. No production, no provider calls, no database writes. This is compatible with the *known* `CreateDigitalEmployeeDto` field names and the observed VITO Prisma `DigitalEmployee` design, but **FSN1 AgentSpec validator compatibility is not yet established**.

### Provenance (owner FSN1 read-only scans 2026-10-20)

- Source checkout: `/srv/lavolpe/src/vito-platform-bob-riccardo-v1`
- HEAD `a4a376bb229ab3eaf2eeb76a6c8cfc4048b1845d`; **13 modified tracked files, 0 staged**. This proposal lives in a separate **GitHub main-based branch**; no touch, reset, checkout or build in FSN1 dirty worktree.
- Known FSN1 paths: `prisma/schema.prisma`; `apps/api/src/modules/{agent-builder,digital-employees,capabilities,agent-workforce,governed-runtime,audit}/...`.
- FSN1 SHA256 for `apps/api/src/modules/agent-builder/agent-spec.validator.ts`: `1b916d9f37674abd7414bab8f6c0444a01f8270fbcae686ef3ed75af29b71369`. This file is **absent on GitHub main**, so its exact validation shape has NOT been read or tested via this PR.
- FSN1 contracts report also confirmed `DigitalEmployee.status`, `employeeType`, `version`, capabilities with `isEnabled`, `requiresApproval`, tasks and central `AuditService`.
- AOE Draft PRs `aoe-app` #37–#41: latest N1E `2abfddcea81637923a4ec5309dc1410fbeedf9c3`; workstation source QA `PASS_147_OF_147` including synthetics, **NO external independent human evaluation**.

### What is in this package

- `profile.proposal.json`: `record` maps to **proposed** VITO DigitalEmployee create DTO: `DOROTHEA`, `dorothea`, `SPECIALIST`, `DRAFT`, `0.1.0`; eight **ungranted and disabled** capability proposals. A capability row is a *planning entry*; it is not an active VITO capability or entitlement.
- `mission.proposal.json`: first ADOREN Quality Baseline mission, **not dispatched**, zero runtime budget and zero access to real user data.
- `validate-proposal.mjs`: standalone **proposal integrity checker**, never the FSN1 `validateAgentSpec`.
- `tests/dorothea-v01-proposal.test.mjs`: 21 source-only Node assertions with negative tests, no DB/Provider/Server calls.

### Explicit functional boundaries

DOROTHEA owns **ADOREN-specific intelligence quality stewardship**: identify evidence gaps, competing hypotheses, risk of unnecessary/repeated questions, premature stopping, decision relevance, linguistic/domain issues, outcome/evaluation methodology, propose experiments with costs and rollback. **She is not the live user-facing ADOREN selector**.

VITO owns tenant, task/mission, capability approval, provider routing, audit and dispatch. RICCARDO handles research/evidence. BOB handles engineering drafts. No second worker, agent builder, research backend, evaluator-of-itself, or scheduler should be created.

### Open validation gates (must not skip)

1. **LOCAL_VALIDATOR_COMPAT:** Inspect the actual FSN1 `AgentSpec` types/validator/policy, **without touching the 13 modified paths**, and map the VITO profile proposal to accepted agent-builder fields. Do not create a fake `AgentSpec` or claim passing the existing validator before it has run.
2. **TENANT_AND_CAPABILITY:** Review `DigitalEmployeesService`, `CapabilitiesService`, grant/activation endpoints, owner approval and safe default `isEnabled=false`; verify VITO authorization from real policy implementation, not just DTO shapes.
3. **AUDIT:** Confirm source provenance and all future approvals/dispatches are auditable, no private answer or secret material in logs.
4. **SYNTHETIC_PREVIEW:** Only after separate owner consent, create an isolated, temporary, **nonregistered** in-memory builder preview and run negative tests; no durable DB object.
5. **OWNER REGISTRATION GATE:** Explicit separate approval before registering even a DRAFT employee in any shared/persistent VITO environment; distinct stronger gate before enabling a capability, scheduling, using external providers or deployment.

### Proposed local syntax/test command after fetching exact Draft-PR commit

```bash
node --check proposals/digital-employees/dorothea-v0.1/validate-proposal.mjs
node --test tests/dorothea-v01-proposal.test.mjs
node proposals/digital-employees/dorothea-v0.1/validate-proposal.mjs
```

Source-only branch and this QA do not grant production readiness: **MERGE=NO_GO · DEPLOY=NO_GO · REGISTRATION=NO_GO · DATA_ACCESS=NO_GO**.
