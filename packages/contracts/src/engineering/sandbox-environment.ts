/**
 * OB-002A — Single Authoritative Governed Sandbox-Environment Contract.
 *
 * The governed execution layer (upstream emission) and the
 * RemoteExecutionWorker sandbox boundary (downstream acceptance) both
 * consume these exact key sets. No module may maintain an independent
 * list; additions/removals must be mirrored here and are enforced by
 * contract-drift tests.
 *
 * Classification:
 *   A. SYSTEM_MANAGED          — server/sandbox-owned keys; a caller can
 *                               never override them (ENV_OVERRIDE_DENIED).
 *   B. PROCESS_COMPATIBILITY   — explicitly permitted from the trusted
 *                               adapter boundary.
 *   C. GOVERNED_EXECUTION_METADATA — server-generated execution context that
 *                               the governed invocation layer may forward.
 *
 * Invariants (enforced by tests and by the sandbox boundary):
 *   - request.env.keys ⊆ PROCESS_COMPATIBILITY ∪ GOVERNED_EXECUTION_METADATA
 *   - request.env.keys ∩ SYSTEM_MANAGED = ∅
 *   - Any key outside the allowlist is rejected (ENV_NOT_ALLOWED).
 *   - No governed metadata key carries credentials/secrets.
 *   - No implicit forwarding of host process.env.
 */

/** Class A — set inside the sandbox by the executor; never caller-overridable. */
export const SANDBOX_SYSTEM_MANAGED_ENV: ReadonlySet<string> = Object.freeze(
  new Set(['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']),
);

/** Class B — explicitly permitted from the trusted adapter boundary. */
export const SANDBOX_PROCESS_COMPATIBILITY_ENV: ReadonlySet<string> = Object.freeze(
  new Set(['PATH', 'USER', 'LANG', 'LC_ALL']),
);

/** Class C — server-generated governed execution metadata. */
export const SANDBOX_GOVERNED_EXECUTION_METADATA_ENV: ReadonlySet<string> = Object.freeze(
  new Set([
    'EXECUTION_TIMEOUT_MS',
    'EXECUTION_MAX_TOKENS',
    'EXECUTION_MAX_COST_MINOR_UNITS',
    'CAPABILITY_CODE',
    'PROVIDER_ID',
    'ORGANIZATION_ID',
    'WORKFLOW_RUN_ID',
    'WORKFLOW_STEP_RUN_ID',
    'CORRELATION_ID',
    'INVOCATION_ID',
  ]),
);

/** B ∪ C — keys a governed adapter request may legitimately supply. */
export const SANDBOX_CALLER_PERMITTED_ENV: ReadonlySet<string> = Object.freeze(
  new Set([
    ...SANDBOX_PROCESS_COMPATIBILITY_ENV,
    ...SANDBOX_GOVERNED_EXECUTION_METADATA_ENV,
  ]),
);

/** A ∪ B ∪ C — every key the sandbox boundary may set (--setenv). */
export const SANDBOX_ENV_ALLOWLIST: ReadonlySet<string> = Object.freeze(
  new Set([
    ...SANDBOX_SYSTEM_MANAGED_ENV,
    ...SANDBOX_CALLER_PERMITTED_ENV,
  ]),
);