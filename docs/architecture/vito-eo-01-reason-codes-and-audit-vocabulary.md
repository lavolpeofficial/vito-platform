# VITO-EO-01 — Reason Codes & Audit Vocabulary

Status: Prepared architecture vocabulary

## Principle
Machines store stable codes; humans receive explanatory metadata. Do not use free text as the primary state reason.

## Workflow block/failure reason codes

### Governance / assurance
- `ASSURANCE_UNSATISFIED`
- `REVIEW_EVIDENCE_INSUFFICIENT`
- `REVIEWER_EXECUTION_NOT_DISTINCT`
- `REVIEWER_PROVIDER_NOT_DISTINCT`
- `BUILDER_MODEL_FAMILY_UNKNOWN`
- `MODEL_FAMILY_REQUIREMENT_UNSATISFIED`
- `REVIEWER_INDEPENDENCE_UNSATISFIED`
- `REVIEW_DISAGREEMENT`
- `HUMAN_DECISION_REQUIRED`
- `HUMAN_APPROVAL_REQUIRED`
- `HUMAN_APPROVAL_REJECTED`
- `LOOP_EXHAUSTED`

### Provider / routing
- `NO_ELIGIBLE_PROVIDER`
- `CAPABILITY_UNSUPPORTED`
- `PROVIDER_DISABLED`
- `PROVIDER_UNHEALTHY`
- `PROVIDER_UNAVAILABLE`
- `QUOTA_UNAVAILABLE`
- `QUOTA_EXHAUSTED`
- `PROVIDER_TIMEOUT`
- `PROVIDER_EXECUTION_FAILED`
- `BUDGET_INCOMPATIBLE`

### Policy / security
- `POLICY_DENIED`
- `POLICY_UNKNOWN`
- `PATH_OUTSIDE_SANDBOX`
- `DENIED_PATH_ACCESS`
- `SECRET_ACCESS_DENIED`
- `GIT_MUTATION_DENIED`
- `NETWORK_ACCESS_DENIED`
- `COMMAND_DENIED`
- `BUDGET_EXHAUSTED`

### Artifact / evidence
- `ARTIFACT_MISSING`
- `ARTIFACT_INVALID`
- `ARTIFACT_HASH_MISMATCH`
- `REVIEW_PACKAGE_INCOMPLETE`
- `VERDICT_INVALID`
- `EVIDENCE_CHAIN_INCOMPLETE`

### Runtime / persistence
- `INVALID_TRANSITION`
- `STALE_TRANSITION`
- `RUN_NOT_RESUMABLE`
- `STEP_STATE_INCONSISTENT`
- `WORKFLOW_DEFINITION_UNKNOWN`
- `WORKFLOW_DEFINITION_VERSION_MISMATCH`

## Reason metadata
A reason event may include structured metadata such as:
- `providerId`
- `capability`
- `requiredAssuranceLevel`
- `actualAssuranceEvidence`
- `expectedState`
- `actualState`
- `artifactRefs`
- `policyVersion`
- `retryCount`
- `correctionLoopCount`

Never place secrets, raw credentials or unrestricted provider prompts in reason metadata.

## Audit event vocabulary

### Workflow lifecycle
- `WORKFLOW_RUN_CREATED`
- `WORKFLOW_RUN_STARTED`
- `WORKFLOW_RUN_RESUMED`
- `WORKFLOW_BLOCKED`
- `WORKFLOW_FAILED`
- `WORKFLOW_COMPLETED`
- `WORKFLOW_CANCELLED`

### Step lifecycle
- `WORKFLOW_STEP_CREATED`
- `WORKFLOW_STEP_READY`
- `WORKFLOW_STEP_STARTED`
- `WORKFLOW_STEP_SUCCEEDED`
- `WORKFLOW_STEP_FAILED`
- `WORKFLOW_STEP_SKIPPED`
- `WORKFLOW_TRANSITION_APPLIED`
- `WORKFLOW_TRANSITION_REJECTED`

### Routing / execution
- `PROVIDER_ROUTING_REQUESTED`
- `PROVIDER_CANDIDATE_REJECTED`
- `PROVIDER_SELECTED`
- `PROVIDER_FALLBACK_SELECTED`
- `AGENT_EXECUTION_QUEUED`
- `AGENT_EXECUTION_STARTED`
- `AGENT_EXECUTION_SUCCEEDED`
- `AGENT_EXECUTION_FAILED`
- `AGENT_EXECUTION_TIMED_OUT`
- `AGENT_EXECUTION_POLICY_BLOCKED`
- `AGENT_EXECUTION_QUOTA_BLOCKED`

### Review / assurance
- `REVIEW_PACKAGE_CREATED`
- `REVIEW_STARTED`
- `REVIEW_COMPLETED`
- `REVIEW_VERDICT_PARSED`
- `REVIEW_DISAGREEMENT_DETECTED`
- `ASSURANCE_CHECK_PASSED`
- `ASSURANCE_CHECK_FAILED`
- `CORRECTION_REQUEST_CREATED`
- `CORRECTION_LOOP_ENTERED`
- `CORRECTION_LOOP_EXHAUSTED`

### Human gate / release
- `HUMAN_GATE_CREATED`
- `HUMAN_GATE_APPROVED`
- `HUMAN_GATE_REJECTED`
- `HUMAN_GATE_EXPIRED`
- `RELEASE_EXECUTION_STARTED`
- `RELEASE_EXECUTION_SUCCEEDED`
- `RELEASE_EXECUTION_FAILED`
- `REMOTE_VERIFICATION_SUCCEEDED`
- `REMOTE_VERIFICATION_FAILED`

### Policy / artifact
- `POLICY_EVALUATED`
- `POLICY_DENIED`
- `ARTIFACT_CREATED`
- `ARTIFACT_ACCEPTED_IMMUTABLE`
- `ARTIFACT_INTEGRITY_FAILED`

## Audit record minimum context
Each EO audit event should carry, where applicable:
- organizationId
- workflowRunId
- workflowStepRunId
- agentExecutionId
- providerId
- capability
- correlationId
- causationId
- actorType / actorId
- reasonCode
- artifact refs
- policy/workflow version
- timestamp

## Stability rule
Codes are append-only once used in persisted audit history. Renaming requires an explicit compatibility/migration decision.
