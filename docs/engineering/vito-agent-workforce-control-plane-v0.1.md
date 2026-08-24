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
       +--> Agent Workforce Dispatch
       |      capability + task, never executable/provider choice
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
              - LOCAL_TOOL  -> trusted sandbox launcher -> headless agent
              - CLOUD_LLM   -> later cloud model adapters
              - deterministic tools
                     |
                     v
              governed workspace
                     |
              artifacts + audit ledger
                     |
                     v
                 Human Gate
```

## What v0.1 adds

The existing VITO repository already contained most of the control-plane foundation: durable WorkflowRun/WorkflowStepRun orchestration, provider registry and deterministic provider routing, assurance levels, execution policy, governed invocation, tenant-scoped audit, governed workspaces, idempotency and execution records.

This block adds the missing agent execution bridge:

1. `AgentWorkforceService`
   - accepts capability + task/prompt + workflow identity
   - invokes the existing provider router
   - caller cannot choose provider, command or executable path
   - command alias/default args are provider registration metadata
   - selected provider is re-validated by governed invocation before execution

2. `AgentWorkforceController`
   - authenticated dispatch surface for VITO/n8n
   - organization identity comes from trusted `TenantContext`, not request body
   - restricted to OWNER/ADMIN in v0.1

3. `HeadlessLocalAgentAdapter`
   - provider type `LOCAL_TOOL`
   - executes an already-authorized, already-routed launcher
   - no shell
   - bounded args, prompt and stdout/stderr
   - dedicated HOME/TMP directories inside the governed workspace
   - no adapter-level fallback or authorization

4. `TrustedLocalExecutableResolver`
   - admin-controlled alias -> absolute launcher mapping
   - launchers must resolve inside a separately configured trusted launcher root
   - validates real path, regular file and executable permission
   - records SHA-256 integrity hash
   - rejects worktree-controlled and relative executable paths

5. Governed runtime payload/budget handoff
   - trusted internal server operations can pass bounded adapter payload and execution budget
   - external callers do not gain direct command/executable authority

## Configuration

The executable registered with VITO should be an admin-installed **sandbox launcher**, not a worktree binary. The launcher is responsible for creating the OS/container isolation boundary before starting OpenCode/Codex/etc.

Example only:

```bash
export GOVERNED_WORKSPACE_ROOT=/srv/vito/workspaces
export VITO_TRUSTED_AGENT_LAUNCHER_ROOT=/usr/local/lib/vito-agent-launchers
export VITO_TRUSTED_LOCAL_EXECUTABLES='{"opencode":"/usr/local/lib/vito-agent-launchers/opencode","codex":"/usr/local/lib/vito-agent-launchers/codex"}'
```

Provider registration metadata example:

```json
{
  "commandAlias": "opencode",
  "defaultArgs": ["run", "--auto"]
}
```

Provider declarations remain organization-scoped and must be registered through the existing provider registry with enabled capability assignments. Provider names are not capability codes.

## Security invariants

- No shell execution in the VITO adapter.
- No PATH-based executable discovery.
- No caller-supplied executable path or provider choice.
- No unrestricted inherited environment.
- Agent launcher identity must live under the trusted launcher root.
- No provider may self-authorize.
- Provider routing does not imply execution permission.
- Credential-requiring providers remain fail-closed until a durable credential broker exists.
- Consequential release actions remain fail-closed until a durable HumanGateResolver exists.
- `git push`, merge and production deployment are not automatically granted by this adapter.
- The production launcher must establish OS/container confinement; a working-directory setting alone is not a security sandbox.

## n8n boundary

n8n may call the authenticated Agent Workforce dispatch surface and move workflow data/artifact references. n8n must not select providers, relax policies, inject executable paths or become the release authority.

## Next blocks

### Must-have

1. Production sandbox launcher/remote execution worker (container/bubblewrap class boundary).
2. Durable credential broker / secret references for provider APIs.
3. Durable HumanGateResolver bound to action + run + step + artifact.
4. WorkflowStepRun -> AgentWorkforce dispatch binding.
5. Provider health probes for local/headless agents.
6. Artifact store for complete stdout/stderr/diff/test reports instead of bounded metadata only.
7. n8n workflow/webhook package consuming the dispatch API.

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

VITO should be able to:

1. receive a World Check engineering task,
2. route `CODE_BUILD` / `TEST_EXECUTION` / `RED_TEAM`,
3. start the selected headless agent without Alessandro opening its UI,
4. execute builds/tests/replays in an isolated worker workspace,
5. persist artifacts and audit events,
6. stop at a human release gate.

The operator receives a compact decision package instead of acting as a copy/paste message bus between agents.
