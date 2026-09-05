import { Injectable, Logger } from '@nestjs/common';

const CREDENTIAL_REF_PATTERN = /^[a-zA-Z0-9._:-]{1,256}$/;
const MAX_SECRET_BYTES = 64 * 1024;

@Injectable()
export class ServerCredentialResolver {
  private readonly logger = new Logger(ServerCredentialResolver.name);

  constructor(private readonly credentialsByRef: ReadonlyMap<string, string>) {
    this.logger.log(
      `Server credential resolver initialized with ${String(credentialsByRef.size)} credential reference(s)`,
    );
  }

  has(reference: string): boolean {
    return CREDENTIAL_REF_PATTERN.test(reference) && this.credentialsByRef.has(reference);
  }

  resolve(reference: string): string | null {
    if (!this.has(reference)) return null;
    return this.credentialsByRef.get(reference) ?? null;
  }
}

export function parseServerCredentialsFromEnv(raw: string | undefined): ReadonlyMap<string, string> {
  if (raw === undefined || raw.trim().length === 0) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ServerCredentialResolverError(
      'SERVER_CREDENTIAL_CONFIG_INVALID',
      'VITO_SERVER_CREDENTIALS must be valid JSON',
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServerCredentialResolverError(
      'SERVER_CREDENTIAL_CONFIG_INVALID',
      'VITO_SERVER_CREDENTIALS must be a JSON object keyed by credential references',
    );
  }

  const credentials = new Map<string, string>();
  for (const [reference, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      !CREDENTIAL_REF_PATTERN.test(reference) ||
      typeof secret !== 'string' ||
      secret.length === 0 ||
      Buffer.byteLength(secret, 'utf8') > MAX_SECRET_BYTES
    ) {
      continue;
    }
    credentials.set(reference, secret);
  }
  return credentials;
}

export class ServerCredentialResolverError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ServerCredentialResolverError';
  }
}
