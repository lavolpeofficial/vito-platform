import { Injectable, Logger } from '@nestjs/common';
import { ProviderType, type CredentialBroker } from '@vito/contracts';
import type { ProviderResolver } from '../governed-invocation/governed-invocation.service';
import { CloudExecutionProfileRegistry } from './cloud-execution-profile.registry';

const CREDENTIAL_REF_PATTERN = /^[a-zA-Z0-9._:-]{1,256}$/;
/** Per-entry cap to bound in-memory secret handling. */
const MAX_AUTH_JSON_BYTES = 1024 * 1024;

/**
 * Server-owned credential store for the cloud-governed boundary.
 *
 * Values are NEVER logged, returned as invocation metadata, or materialized
 * outside an ephemeral cloud session HOME. The registry only ever hands out
 * opaque references; the resolver maps a reference to the auth.json payload
 * only inside the ephemeral boundary that immediately tears it down.
 */
@Injectable()
export class CloudCredentialResolver {
  private readonly logger = new Logger(CloudCredentialResolver.name);
  private readonly credentialsByRef: ReadonlyMap<string, string>;

  constructor(credentials: ReadonlyMap<string, string>) {
    this.credentialsByRef = credentials;
    this.logger.log(
      `Cloud credential resolver initialized with ${String(credentials.size)} credential reference(s)`,
    );
  }

  has(reference: string): boolean {
    if (typeof reference !== 'string' || !CREDENTIAL_REF_PATTERN.test(reference)) {
      return false;
    }
    return this.credentialsByRef.has(reference);
  }

  /**
   * Resolve the auth.json payload for a reference.
   * Returns null on unknown ref (fail closed). The payload must only be
   * written into an ephemeral session artifact and must never be observed
   * in logs or audit output.
   */
  resolve(reference: string): string | null {
    if (!this.has(reference)) {
      return null;
    }
    return this.credentialsByRef.get(reference) ?? null;
  }
}

/**
 * Parse the server-owned credential map from environment.
 * Format: VITO_CLOUD_AGENT_CREDENTIALS = JSON object { "<credentialRef>": "<authJson>" }.
 * Malformed refs or values are dropped (fail closed); a reference used by a
 * profile but missing here means the broker returns null and execution fails.
 */
export function parseCloudCredentialsFromEnv(
  raw: string | undefined,
): ReadonlyMap<string, string> {
  if (raw === undefined || raw.trim().length === 0) {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CloudCredentialResolverError(
      'CLOUD_CREDENTIAL_CONFIG_INVALID',
      'VITO_CLOUD_AGENT_CREDENTIALS is not valid JSON — failing closed with no credentials',
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CloudCredentialResolverError(
      'CLOUD_CREDENTIAL_CONFIG_INVALID',
      'VITO_CLOUD_AGENT_CREDENTIALS must be a JSON object keyed by credential references',
    );
  }

  const map = new Map<string, string>();
  for (const [reference, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof reference !== 'string' ||
      !CREDENTIAL_REF_PATTERN.test(reference) ||
      typeof value !== 'string' ||
      value.length === 0 ||
      Buffer.byteLength(value, 'utf8') > MAX_AUTH_JSON_BYTES
    ) {
      continue;
    }
    map.set(reference, value);
  }
  return map;
}

export class CloudCredentialResolverError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CloudCredentialResolverError';
  }
}

/**
 * CredentialBroker for the CLOUD_GOVERNED tier.
 *
 * Resolves a credentialReference ONLY for a CLOUD_LLM provider bound to an
 * enabled server-owned profile whose credentialRef the store can satisfy.
 * Fail closed: any missing/misconfigured link returns null, and the governed
 * invocation then fails with CREDENTIAL_INJECTION_FAILED before execution.
 */
@Injectable()
export class CloudCredentialBroker implements CredentialBroker {
  constructor(
    private readonly providerResolver: ProviderResolver,
    private readonly profileRegistry: CloudExecutionProfileRegistry,
    private readonly credentialResolver: CloudCredentialResolver,
  ) {}

  async getCredentialReference(
    providerId: string,
    organizationId: string,
  ): Promise<string | null> {
    const provider = await this.providerResolver.resolve(providerId, organizationId);
    if (!provider || provider.providerType !== ProviderType.CLOUD_LLM) {
      return null;
    }

    const profile = this.profileRegistry.resolve(provider.providerCode);
    if (!profile) {
      return null;
    }

    if (!this.credentialResolver.has(profile.credentialRef)) {
      return null;
    }

    return profile.credentialRef;
  }

  async validateCredentialReference(reference: string): Promise<boolean> {
    return this.credentialResolver.has(reference);
  }
}