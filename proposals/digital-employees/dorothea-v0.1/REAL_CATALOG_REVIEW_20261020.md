# DOROTHEA v0.1 – Real-catalog AgentSpec compatibility review

**Date:** 2026-10-20  
**Mode:** offline, source-only, no VITO registration, no providers, no SSH, no DB changes.  
**Source FSN1 HEAD:** `a4a376bb229ab3eaf2eeb76a6c8cfc4048b1845d`  
**Actual FSN1 validator SHA256:** `1b916d9f37674abd7414bab8f6c0444a01f8270fbcae686ef3ed75af29b71369`  
**Actual FSN1 capability policy SHA256:** `211a4359c51f48d07dcbb6357cdd15d326e2579e6677d62a21e8d5dd236fbae0`

## Findings

- The original FSN1 `BOB_CAPABILITY_CATALOG` contains **30 capability declarations**, all `defaultEnabled:false`. A declaration is not proof of a live adapter, granted permission or database registration.
- None of the previously proposed eight `adoren.*` capability codes appears in the catalog. The original `validateAgentSpec` will fail closed for all of them.
- The original validator accepts read-only `SPECIALIST` AgentSpecs with **catalogued** capabilities and imports their name/description/risk/approval flags from the policy, ignoring caller-supplied governance fields.
- A **seven-capability, all-disabled** draft using existing catalog keys passes the pinned original validator with the actual pinned original policy in an isolated Node/TypeScript test harness. Proposed use:
  - `knowledge.read`: approved knowledge only, no ADOREN repository permission implied.
  - `research.quality.check`: existing quality-check declaration, not a new Dorothea research platform.
  - `tasks.suggest`: proposals only; task creation and execution remain owner-gated.
  - `vito.dialogue`: governed internal communication.
  - `audit.read`: only tenant-authorized and source-approved audit excerpts.
  - `workflows.observe`: observe read-only workflow status if an actual authorized adapter exists.
  - `daily.report`: draft quality summaries, no autonomous scheduling.
- `research.search` was deliberately **not** added; primary external research belongs to RICCARDO.
- The proposed `runtime.route=/dorothea` is **not implemented**. Validator acceptance of a route string does not create an actual page or route.
- FSN1 `AgentBuilderService.executeStage` currently checks BOB-specific build/route artifacts; these cannot attest a DOROTHEA route.
- The `AgentSpec` contains no `status` key; the separate `DigitalEmployee` registration API controls `DRAFT/ACTIVE`. Creating even a DRAFT employee is a database mutation and **not approved**.
- No effective privileges are granted by this JSON alone. The v0.1 candidate specifies `dataAccess.read=[]`, `dataAccess.write=[]`, `execution.authority=NONE`, `connectors=[]`, all capabilities `defaultEnabled=false`.

## Offline QA performed (2026-10-20)

**`PASS_13_REAL_CATALOG_VALIDATOR_SOURCE_ONLY`**, zero failed, using unchanged real FSN1 `agent-spec.validator.ts` and `bob.policy.ts`, both SHA-pinned, TypeScript transpilation, and minimal stub modules only for `@nestjs/common` + `@prisma/client`. Tested real catalog size; denial of original eight unknown codes; acceptance of seven-code candidate; server-owned risk/approval values; and denial of enabled capabilities, writes, unauthorized execution, non-staging, unexcluded payment, credential connectors and missing audit checks.

**Test limitation:** The test invokes the real validator source with the real catalog in a sealed offline harness. It is **not** a real VITO API, runtime, live adapter, Auth/tenant, database, route or agent-builder staging test. This branch does not include FSN1 source files because its original source checkout has 13 tracked modifications and must not be touched.

The previous `21/21` DOROTHEA proposal-only QA passed at exact older PR SHA `bea4e9cca541204bc3f8f198cb0189ee8047c7c6`. A new owner QA for the expanded Draft PR HEAD is recommended before any status change.

## Required next engineering gates

1. **Single source of capabilities:** Decide whether agent-specific capabilities should be added to the existing server-owned catalog under `adoren.*` or exposed via existing narrow approved adapters, avoiding a parallel Dorothea registry.
2. **Concrete ADOREN interfaces:** Add only the minimal read-only contracts to versioned, synthetic/aggregate AOE evaluation reports; confirm authenticated tenant-scoped authorization and explicit allowed source types. `knowledge.read` alone does not grant `aoe-app` access.
3. **Agent-specific staging evidence:** Remove hardcoded BOB-only route/build proof for DOROTHEA validation through an approved generic agent-scoped staging gate; fail if no agent route/build exists.
4. **Runtime & model design:** Define what inference/model is used to analyze evidence; a valid `AgentSpec` alone provides no reasoning engine. Any provider, cost budget, schedule or offline inference activation requires a separate owner approval.
5. **Independent evaluation:** Compare Dorothea-generated quality proposals against reproducible baselines, non-overlapping synthetic holdouts and independent reviewers. AOE N1A–N1E do not establish outcome effectiveness.
6. **Security / owner gates:** Require fail-closed negative tests for forged approval, tenant crossover, data leakage, injected evidence, concurrency, cost escape and duplicate task execution.

**Status:** `SOURCE_CATALOG_COMPAT=PASS_OFFLINE_7_CODE_CANDIDATE` · `SPECIALIZED_ADOREN_CAPABILITIES=NOT_IMPLEMENTED` · `ACTIVE_AGENT=NO` · `REGISTRATION=NO_GO` · `MERGE=NO_GO` · `DEPLOY=NO_GO`.
