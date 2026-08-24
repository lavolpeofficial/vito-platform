# VITO Agent Workforce Control Plane v0.1

## Purpose

VITO is the control plane. Workflow engines and model/agent products are replaceable execution components.

Core rule:

> Capability != Provider != Execution Permission != Execution

## Architecture

```text
AOE / Human Intent
       |
       v
     VITO
  task + assurance + governance
       |
       +--> Provider Router
       |      capability / health / quota / cost / independence
       |
       +--> Workflow Runtime
       |      deterministic state machine / retries / human gates
       |
       +--> Governed Invocation
              execution policy / workspace / executable trust
                     |
                     v
              Provider Adapter
              - LOCAL_TOOL  -> headless coding agent (OpenCode, Codex, ...)
              - CLOUD_LLM   -> later cloud model adapters
              - deterministic tools
                     |
                     v
              isolated workspace
                     |
              artifacts + audit ledger
                     |
                     v
                 Human Gate
```

## What v0.1 adds

The existing VITO repository already contains the majority of the control-plane foundation: durable WorkflowRun/WorkflowStepRun orchestration, provider registry and deterministic provider routing, assurance levels, execution policy, governed invocation, tenant-scoped audit, governed workspaces, idempotency and execution records.

This block adds the missing local-agent execution boundary:

1. `HeadlessLocalAgentAdapter`
   - provider type `LOCAL_TOOL`
   - executes an already-authorized, already-routed tool
   - no shell
   - no PATH lookup
   - bounded args, prompt and stdout/stderr
   - dedicated HOME/TMP directories inside the governed workspace
   - no adapter-level fallback or authorization

2. `TrustedLocalExecutableResolver`
   - admin-controlled alias -> absolute executable mapping
   - validates real path, regular file and executable permission
   - records SHA-256 integrity hash
   - rejects worktree-controlled and relative executable paths

3. Governed runtime payload handoff
   - trusted internal server operations can pass a bounded adapter payload
   - external callers do not gain direct payload authority

## Configuration

Example only:

```bash
export GOVERNED_WORKSPACE_ROOT=/srv/vito/workspaces
export VITO_TRUSTED_LOCAL_EXECUTABLES='{"opencode":"/usr/local/bin/opencode","codex":"/usr/local/bin/codex"}'
```

Provider declarations remain organization-scoped and must be registered through the existing provider registry with enabled capability assignments. Provider names are not capability codes.

## Security invariants

- No shell execution.
- No PATH-based executable discovery.
- No caller-supplied executable path.
- No unrestricted inherited environment.
- No provider may self-authorize.
- Provider routing does not imply execution permission.
- Credential-requiring providers remain fail-closed until a durable credential broker exists.
- Consequential actions remain fail-closed until a durable HumanGateResolver exists.
- `git push`, merge and production deployment are not automatically granted by this adapter.
- Agent work happens only inside governed workspaces.

## Next blocks

### Must-have

1. Durable credential broker / secret references for provider APIs.
2. Durable HumanGateResolver bound to action + run + step + artifact.
3. Agent-task facade that converts WorkflowStepRuns to governed invocations.
4. Provider health probes for local/headless agents.
5. Artifact store for complete stdout/stderr/diff/test reports instead of bounded metadata only.
6. n8n adapter/webhook integration as execution workflow engine, not as VITO authority.

### Should-have

- separate builder/reviewer worktrees
- AL-4 multi-family reviewer requirement
- cost/token budgets and provider usage ingestion
- performance ledger and historical routing quality
- remote execution worker deployment profile

### Nice-to-have

- live log streaming UI
- parallel workers
- automatic arbitration
- dynamic cost optimization

## First acceptance workflow

`WORLD_CHECK_COUNTRY_RUN_V1`

VITO should eventually be able to:

1. receive a World Check engineering task,
2. route `CODE_BUILD` / `TEST_EXECUTION` / `RED_TEAM`,
3. start the selected headless agent without Alessandro opening the UI,
4. execute builds/tests/replays in an isolated workspace,
5. persist artifacts and audit events,
6. stop at a human release gate.

The operator should receive a compact decision package, not act as a copy/paste message bus between agents.
