# VITO-EO-01.5 — Governed Capability Invocation & Provider Adapter Boundary
## Builder Specification v0.1

Status: BUILD SPEC
Base: main

Dependency gates:
- EO-01.1 contracts/state machine
- EO-01.2 workflow runtime
- EO-01.3 provider registry/router
- EO-01.4 execution policy & sandbox contract

## 1. Objective

Implement the first governed execution boundary through which VITO may
invoke an eligible capability provider after routing and policy approval.

EO-01.5 is NOT a generic output-generation engine.

VITO remains the workforce/orchestration layer.

Domain knowledge and domain-specific output remain owned by the relevant
domain capability/provider, such as future:

- PURITAS
- NUTRIS
- KINESIS
- DOMUS
- DIGITALIS
- SUSTENTATIO
- ASTRA where operational invocation is appropriate
- specialized digital employees
- deterministic tools
- governed LLM providers

Core flow:

Human-authorized intent
→ VITO orchestration
→ capability request
→ EO-01.3 provider routing
→ EO-01.4 execution-policy evaluation
→ EO-01.5 governed invocation
→ normalized execution result

Core invariant:

Routing eligibility != execution permission != execution.

All three must remain separate.

## 2. Architectural responsibility

### AOE owns
- orientation
- decision-space structuring
- intervention/capability recommendation

### Human owns
- consequential decision
- approval where Human Gate is required

### VITO owns
- orchestration
- capability invocation coordination
- provider selection request
- workflow/run state
- execution supervision

### Domain/provider owns
- domain expertise
- capability implementation
- domain-specific work product
- domain-specific output semantics

### EO-01.5 owns
- governed invocation contract
- adapter boundary
- invocation lifecycle
- normalized result envelope
- timeout/cancellation propagation
- provider execution metadata
- enforcement handoff to EO-01.4

EO-01.5 MUST NOT absorb domain knowledge into VITO.

## 3. Domain architecture invariant

Knowledge lives in domains.

OSSERVATORE/AOE may discover, retrieve and synthesize domain knowledge,
but VITO MUST NOT become the canonical knowledge owner for PURITAS,
NUTRIS, KINESIS, DOMUS, ASTRA, SUSTENTATIO or other LA VOLPE domains.

EO-01.5 therefore invokes capabilities by contract.

Example future capability codes:

puritas.hygiene.assess
puritas.cleaning-plan.create
nutris.nutrition.assess
nutris.meal-plan.create
kinesis.movement-plan.create
digitalis.system.audit
sustentatio.process.analyze

These examples define architectural direction only.
Do NOT implement these domains in EO-01.5.

## 4. Required invocation contract

Introduce a strongly typed GovernedCapabilityInvocationRequest.

At minimum:

- invocationId
- organizationId
- workflowRunId
- workflowStepRunId
- correlationId
- capabilityCode
- providerId
- executionProfile
- assuranceLevel where applicable
- inputReference or governed input payload
- executionBudget
- policy context
- requestedAt

Do not include raw credentials.

Do not include unrestricted process environment.

Do not assume provider eligibility implies execution permission.

## 5. Required invocation lifecycle

EO-01.5 MUST NOT introduce a second or parallel execution state machine.

Reuse the existing authoritative status vocabulary:

- WorkflowRunStatus for overall workflow state
- WorkflowStepStatus for workflow-step state
- AgentExecutionStatus for an individual provider/agent execution
- ExecutionOutcome for normalized policy/timeout/quota/cancellation outcomes

In particular, provider invocation state MUST reuse AgentExecutionStatus:

- QUEUED
- STARTING
- RUNNING
- SUCCEEDED
- FAILED
- TIMED_OUT
- CANCELLED
- POLICY_BLOCKED
- QUOTA_BLOCKED

EO-01.5 may introduce strongly typed invocation failure/reason codes where
existing status enums are not sufficiently descriptive, but these reason
codes MUST NOT become another lifecycle state machine.

State transitions MUST remain explicit and fail closed.

Illegal transitions MUST reject.

WorkflowRunStatus, WorkflowStepStatus, AgentExecutionStatus and
ExecutionOutcome MUST NOT be duplicated or replaced.

## 6. Mandatory execution sequence

A productive invocation MUST follow:

1. validate invocation request
2. resolve provider declaration
3. verify provider/capability assignment
4. verify provider remains routable/eligible
5. create EO-01.4 PolicyEvaluationContext
6. evaluate EO-01.4 policy
7. DENY immediately when policy denies
8. only then construct governed adapter invocation
9. execute through registered adapter
10. normalize result
11. record audit metadata
12. update workflow/invocation state

There MUST be no adapter path that bypasses EO-01.4.

This is a mandatory trust-boundary invariant.

## 7. Adapter boundary

Define a provider adapter interface.

Conceptually:

interface GovernedProviderAdapter {
  readonly providerType: ProviderType;

  execute(
    request: GovernedAdapterRequest,
    context: GovernedExecutionContext,
  ): Promise<GovernedAdapterResult>;
}

Exact naming may follow repository conventions.

Adapters MUST NOT decide authorization.

Adapters MUST receive an already-approved governed execution context.

Adapters MUST NOT silently elevate permissions.

Adapters MUST NOT perform fallback routing themselves.

Provider fallback remains an orchestration/router concern.

## 8. No self-controlled executable resolution

A safe command name MUST NOT be sufficient authorization if the executable
implementation can be replaced by the same actor controlling the worktree.

EO-01.5 must therefore make the executable/runtime boundary explicit.

For command-backed adapters, do not blindly trust:

- worktree-local node_modules/.bin
- mutable PATH supplied by the task
- package.json script indirection
- arbitrary npm/npx/pnpm/yarn exec
- task-controlled executable paths

If the runtime cannot prove the executable identity or trusted execution
environment, fail closed.

Do not build a complete container sandbox in EO-01.5.

Model the invariant and provide a minimal trusted adapter mechanism.

## 9. Credential boundary

Provider credentials:

- MUST NOT enter model/task prompts
- MUST NOT be persisted in PolicyDecision
- MUST NOT be emitted in adapter result
- MUST NOT be copied into audit events
- MUST be injected only at the adapter boundary
- MUST be minimum-scope
- MUST be provider-specific

EO-01.5 does not need a full secret broker.

Use an interface/abstraction that allows a future secret broker without
redesigning the invocation contract.

## 10. Environment boundary

Adapters MUST NOT inherit unrestricted process environment by default.

Use an explicit environment allowlist/minimal environment contract where
environment is required.

Unknown environment requirements must fail closed for productive execution.

## 11. Human Gate binding

Where Human Gate approval is required, approval context must be bindable to:

- organizationId
- workflowRunId
- workflowStepRunId
- capabilityCode
- providerId where applicable
- artifact/revision/input reference
- approval identity/reference
- approval timestamp
- expiry or validity context where applicable

EO-01.5 must not treat a generic APPROVED boolean as universal authority
for unrelated invocations.

Reuse EO-01.4 release-gate semantics where compatible.

Do NOT implement autonomous release authority.

## 12. Normalized result envelope

Define GovernedCapabilityInvocationResult.

At minimum:

- invocationId
- organizationId
- workflowRunId
- workflowStepRunId
- correlationId
- capabilityCode
- providerId
- status
- startedAt
- completedAt
- durationMs
- outputReference where applicable
- artifactReferences where applicable
- evidenceReferences where applicable
- providerExecutionMetadata
- normalized error information
- policyDecisionReference or safe policy metadata
- sideEffectSummary
- usage metadata where measurable

Result envelope MUST NOT require VITO to own or understand the complete
domain-specific output schema.

Domain output should preferably be referenced through governed artifacts
or typed domain payloads.

## 13. Audit requirements

Record enough information to reconstruct:

- who/what requested execution
- which capability
- which provider
- why that provider was eligible
- which policy decision authorized/blocked execution
- when execution started/completed
- final outcome
- measurable usage/cost where available
- governed side effects

Never persist:

- raw provider credentials
- unrestricted environment
- complete secret-bearing command output
- private key material
- tokens

## 14. Failure semantics

Preserve and reuse:

- POLICY_BLOCKED
- TIMED_OUT
- QUOTA_BLOCKED
- CANCELLED

Also model these as invocation failure/reason codes, not as a new
execution-status lifecycle:

- PROVIDER_UNAVAILABLE
- ADAPTER_NOT_REGISTERED
- CAPABILITY_NOT_SUPPORTED
- PROVIDER_NOT_ELIGIBLE
- INVOCATION_INVALID
- EXECUTION_FAILED

The final execution status should map onto the existing AgentExecutionStatus
and ExecutionOutcome vocabulary wherever applicable.

Failures must remain distinguishable from review/code-quality findings.

## 15. Required tests

At minimum prove:

1. valid routed provider + policy allow -> adapter executes
2. routed provider + policy deny -> adapter never executes
3. unsupported capability -> deny/no execution
4. disabled provider -> no execution
5. unhealthy/unavailable provider -> no execution
6. missing provider -> no execution
7. missing adapter -> fail closed
8. unknown adapter/provider type -> fail closed
9. builder cannot gain release authority through invocation
10. reviewer cannot gain productive write capability through invocation
11. orchestrator cannot bypass execution policy
12. credentials never appear in invocation result
13. credentials never appear in audit-safe output
14. unrestricted environment is not propagated
15. timeout -> TIMED_OUT
16. quota condition -> QUOTA_BLOCKED
17. cancellation -> CANCELLED
18. adapter exception -> normalized EXECUTION_FAILED
19. provider fallback does not occur inside adapter
20. adapter is never called before EO-01.4 allow decision
21. capability/provider mismatch -> deny
22. organization mismatch -> deny
23. workflow/correlation IDs preserved end-to-end
24. output may be artifact/reference rather than VITO-owned domain output
25. invocation execution state reuses AgentExecutionStatus and rejects illegal transition
26. Human Gate approval cannot be reused for unrelated invocation context
27. mutable worktree executable cannot become trusted merely from safe command name

Tests must prove behavior, not merely configuration defaults.

## 16. Compatibility requirements

EO-01.5 must reuse rather than replace:

- EO-01.1 state contracts
- EO-01.2 workflow/runtime contracts
- EO-01.3 ProviderDeclaration
- EO-01.3 ProviderCapabilityAssignment
- EO-01.3 routing semantics
- EO-01.4 ExecutionProfile
- EO-01.4 ExecutionAction
- EO-01.4 PolicyDecision
- EO-01.4 evaluatePolicy()
- EO-01.4 ExecutionOutcome
- EO-01.1 AgentExecutionStatus
- EO-01.1 WorkflowRunStatus
- EO-01.1 WorkflowStepStatus

No parallel provider registry.
No parallel permission system.
No parallel execution-status enum.
No second workflow state machine.

## 17. Non-goals

Do NOT implement:

- PURITAS itself
- NUTRIS itself
- ASTRA knowledge engine
- OSSERVATORE knowledge ingestion
- AOE orientation logic
- domain knowledge migration
- final user-facing response generation
- IMPARO learning loop
- autonomous commit/push
- release merge automation
- generic shell execution service
- Kubernetes/container sandbox
- generic secret broker
- billing platform
- generic agent marketplace
- EO-01.6 functionality beyond the minimum normalized result contract
- EO-01.7 release automation

## 18. Validation

Required before review:

- contracts focused EO-01.5 tests
- complete contracts tests
- TypeScript validation
- Prisma generate if schema changes
- API tests
- API build
- regression EO-01.1–EO-01.4
- git status/diff inspection
- no unintended files
- independent adversarial review

## 19. Gate

EO-01.5 may open only if:

- adapter execution cannot bypass EO-01.4
- routing remains distinct from permission
- adapters cannot grant themselves authority
- credentials remain isolated
- environment propagation is governed
- invocation lifecycle is explicit
- results are normalized/auditable
- VITO does not become owner of domain knowledge/output semantics
- tests/build pass
- adversarial review finds no blocking trust-boundary bypass

