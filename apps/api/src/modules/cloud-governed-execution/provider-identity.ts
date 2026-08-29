/**
 * Sanitized, machine-readable observed provider/model identity extraction
 * (OB002D-MEDIUM-PROVIDER-IDENTITY).
 *
 * The server-owned CLOUD_GOVERNED boundary authorizes a provider identity via
 * CloudExecutionProfile.expectedProviderId (and an optional model allow-list)
 * and MUST observe the identity the coding agent actually executed with. This
 * module parses that identity from the trusted launcher's own log lines
 * (`message=stream ... agent=build providerID=... modelID=...` and
 * `llm provider/model` selection lines).
 *
 * Security properties:
 *  - Tokens are STRICTLY validated against conservative charsets and lengths;
 *    anything else is treated as an invalid/ambiguous identity — it can never
 *    smuggle arbitrary text (e.g. credential values) into evidence.
 *  - Multiple distinct runtime-selected identities, conflicted build/runtime
 *    identities, or a missing coding-agent (build) identity fail closed.
 *  - Missing identity evidence must never be silently accepted.
 */

export interface ObservedProviderIdentity {
  readonly providerId: string;
  readonly modelId: string;
}

export type ProviderIdentityErrorCode =
  | 'PROVIDER_IDENTITY_MISSING'
  | 'PROVIDER_IDENTITY_AMBIGUOUS';

export type ProviderIdentityParse =
  | { readonly ok: true; readonly identity: ObservedProviderIdentity }
  | { readonly ok: false; readonly code: ProviderIdentityErrorCode };

const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:\/-]{1,128}$/;

const TOKEN_SEPARATOR = '\u0000';

function kv(line: string, key: string): string | null {
  const match = line.match(new RegExp(`(?:^|\\s)${key}=([^\\s]+)`));
  return match ? match[1] : null;
}

function isValidProviderId(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value);
}

function isValidModelId(value: string): boolean {
  return MODEL_ID_PATTERN.test(value);
}

function isStreamBuildLine(line: string): boolean {
  return line.includes('message=stream') && line.includes('agent=build');
}

function isRuntimeSelectedLine(line: string): boolean {
  return line.includes('llm.provider=') && line.includes('llm.model=');
}

/**
 * Extract the observed provider/model identity from captured launcher output.
 *
 * Fail-closed outcomes:
 *  - `PROVIDER_IDENTITY_MISSING`   — no coding-agent (build) stream identity.
 *  - `PROVIDER_IDENTITY_AMBIGUOUS` — multiple/conflicting build identities,
 *    multiple distinct runtime-selected identities, a runtime identity that
 *    contradicts the build identity, or any malformed/smuggled token.
 */
export function extractProviderIdentity(output: string): ProviderIdentityParse {
  const buildTuples = new Set<string>();
  const runtimeTuples = new Set<string>();
  let sawInvalidToken = false;

  for (const line of output.split('\n')) {
    if (isStreamBuildLine(line)) {
      const provider = kv(line, 'providerID');
      const model = kv(line, 'modelID');
      if (provider === null || model === null) {
        sawInvalidToken = true;
        continue;
      }
      if (!isValidProviderId(provider) || !isValidModelId(model)) {
        sawInvalidToken = true;
        continue;
      }
      buildTuples.add(provider + TOKEN_SEPARATOR + model);
      continue;
    }
    if (isRuntimeSelectedLine(line)) {
      const provider = kv(line, 'llm.provider');
      const model = kv(line, 'llm.model');
      if (provider === null || model === null) {
        continue;
      }
      if (!isValidProviderId(provider) || !isValidModelId(model)) {
        sawInvalidToken = true;
        continue;
      }
      runtimeTuples.add(provider + TOKEN_SEPARATOR + model);
    }
  }

  if (sawInvalidToken) {
    return { ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' };
  }
  if (buildTuples.size === 0) {
    return { ok: false, code: 'PROVIDER_IDENTITY_MISSING' };
  }
  if (buildTuples.size !== 1) {
    return { ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' };
  }
  if (runtimeTuples.size > 1) {
    return { ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' };
  }

  const [buildTuple] = [...buildTuples];
  if (runtimeTuples.size === 1 && [...runtimeTuples][0] !== buildTuple) {
    return { ok: false, code: 'PROVIDER_IDENTITY_AMBIGUOUS' };
  }

  const [providerId, modelId] = buildTuple.split(TOKEN_SEPARATOR);
  return {
    ok: true,
    identity: { providerId, modelId },
  };
}