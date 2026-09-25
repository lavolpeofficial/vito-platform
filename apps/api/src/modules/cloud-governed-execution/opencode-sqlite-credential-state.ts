import { join } from 'node:path';

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_CREDENTIAL_VALUE_BYTES = 1024 * 1024;

type SqliteRunResult = { readonly changes: number | bigint };
type SqliteStatement = {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): SqliteRunResult;
};
type SqliteDatabase = {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
};
type DatabaseSyncCtor = new (
  path: string,
  options?: { readonly readOnly?: boolean },
) => SqliteDatabase;

type CredentialRow = {
  id: string;
  integrationId: string;
  value: string;
};

type OAuthValue = {
  type: 'oauth';
  methodID: string;
  access: string;
  refresh: string;
  expires: number;
};

type ParsedCredential =
  | { kind: 'oauth'; value: OAuthValue }
  | { kind: 'other' };

export type OpenCodeOAuthCredentialSyncResult = {
  readonly updated: boolean;
};

export class OpenCodeCredentialStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OpenCodeCredentialStateError';
  }
}

/**
 * Persist only a provider's rotated OAuth credential from an ephemeral
 * OpenCode session back into VITO's server-owned credential-state database.
 *
 * Security / integrity invariants:
 * - sourceDbPath is VITO-owned writable durable state, never the read-only operator seed;
 * - never copies the whole session DB back;
 * - never persists session/message/project state;
 * - never logs or returns credential values;
 * - provider id, credential id and OAuth method must remain stable;
 * - a changed OAuth credential must advance expiry monotonically;
 * - optimistic source comparison + BEGIN IMMEDIATE prevents stale overwrite;
 * - the durable DB is forced to rollback-journal mode so future snapshot
 *   materialization never depends on an un-copied WAL sidecar.
 */
export function syncRotatedOpenCodeOAuthCredential(input: {
  readonly sourceDbPath: string;
  readonly sessionDir: string;
  readonly providerId: string;
}): OpenCodeOAuthCredentialSyncResult {
  if (!PROVIDER_ID_PATTERN.test(input.providerId)) {
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_PROVIDER_INVALID',
      'OpenCode OAuth credential provider identity is invalid',
    );
  }

  const sessionDbPath = join(input.sessionDir, '.local/share/opencode/opencode.db');
  let sourceRead: SqliteDatabase | null = null;
  let sessionRead: SqliteDatabase | null = null;

  try {
    sourceRead = openDatabase(input.sourceDbPath, { readOnly: true });
    sessionRead = openDatabase(sessionDbPath, { readOnly: true });

    const sourceRow = readActiveCredential(sourceRead, input.providerId);
    if (!sourceRow) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_SOURCE_CREDENTIAL_MISSING',
        'Server-owned OpenCode credential state has no active credential for the authorized provider',
      );
    }

    const sessionRow = readCredentialById(
      sessionRead,
      sourceRow.id,
      input.providerId,
    );
    if (!sessionRow) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_SESSION_CREDENTIAL_MISSING',
        'Ephemeral OpenCode session lost the authorized provider credential',
      );
    }

    const sourceCredential = parseCredential(sourceRow.value);
    const sessionCredential = parseCredential(sessionRow.value);

    if (sourceCredential.kind === 'other' && sessionCredential.kind === 'other') {
      return { updated: false };
    }

    if (
      sourceCredential.kind !== 'oauth' ||
      sessionCredential.kind !== 'oauth'
    ) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_CREDENTIAL_TYPE_CHANGED',
        'OpenCode credential type changed during governed execution; refusing persistence',
      );
    }

    const before = sourceCredential.value;
    const after = sessionCredential.value;

    if (before.methodID !== after.methodID) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_METHOD_CHANGED',
        'OpenCode OAuth method changed during governed execution; refusing persistence',
      );
    }

    if (sameOAuthCredential(before, after)) {
      return { updated: false };
    }

    if (after.expires <= before.expires) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_ROTATION_NOT_MONOTONIC',
        'OpenCode OAuth credential changed without advancing expiry; refusing persistence',
      );
    }

    sourceRead.close();
    sourceRead = null;
    sessionRead.close();
    sessionRead = null;

    persistCredentialAtomically({
      sourceDbPath: input.sourceDbPath,
      providerId: input.providerId,
      expectedRow: sourceRow,
      nextRawValue: sessionRow.value,
      nextExpires: after.expires,
    });

    return { updated: true };
  } catch (error) {
    if (error instanceof OpenCodeCredentialStateError) {
      throw error;
    }
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_CREDENTIAL_STATE_FAILED',
      'OpenCode OAuth credential state reconciliation failed closed',
    );
  } finally {
    closeQuietly(sourceRead);
    closeQuietly(sessionRead);
  }
}

function persistCredentialAtomically(input: {
  readonly sourceDbPath: string;
  readonly providerId: string;
  readonly expectedRow: CredentialRow;
  readonly nextRawValue: string;
  readonly nextExpires: number;
}): void {
  const db = openDatabase(input.sourceDbPath);
  let inTransaction = false;

  try {
    // Keep the durable state self-contained in the main DB file. The executor
    // materializes a bounded snapshot and intentionally does not copy WAL/SHM.
    db.exec('PRAGMA journal_mode=DELETE');
    db.exec('PRAGMA synchronous=FULL');
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;

    const current = readActiveCredential(db, input.providerId);
    if (!current || current.id !== input.expectedRow.id) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_SOURCE_CREDENTIAL_CHANGED',
        'Server-owned OpenCode credential identity changed concurrently; refusing stale overwrite',
      );
    }

    if (current.value !== input.expectedRow.value) {
      const currentCredential = parseCredential(current.value);
      if (
        currentCredential.kind === 'oauth' &&
        currentCredential.value.expires >= input.nextExpires
      ) {
        db.exec('COMMIT');
        inTransaction = false;
        return;
      }
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_SOURCE_CREDENTIAL_CHANGED',
        'Server-owned OpenCode credential changed concurrently; refusing stale overwrite',
      );
    }

    const result = db
      .prepare(
        'UPDATE credential SET value = ?, time_updated = ? WHERE id = ? AND integration_id = ? AND active = 1',
      )
      .run(
        input.nextRawValue,
        Date.now(),
        input.expectedRow.id,
        input.providerId,
      );

    if (Number(result.changes) !== 1) {
      throw new OpenCodeCredentialStateError(
        'OPENCODE_OAUTH_PERSIST_REJECTED',
        'OpenCode OAuth credential rotation did not update exactly one authorized credential row',
      );
    }

    db.exec('COMMIT');
    inTransaction = false;
  } catch (error) {
    if (inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The original fail-closed error is preserved; no secret details escape.
      }
    }
    if (error instanceof OpenCodeCredentialStateError) {
      throw error;
    }
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_PERSIST_FAILED',
      'OpenCode OAuth credential rotation could not be persisted to server-owned state',
    );
  } finally {
    closeQuietly(db);
  }
}

function readActiveCredential(
  db: SqliteDatabase,
  providerId: string,
): CredentialRow | null {
  const row = db
    .prepare(
      'SELECT id, integration_id, value FROM credential WHERE integration_id = ? AND active = 1 ORDER BY time_created DESC, id DESC LIMIT 1',
    )
    .get(providerId);
  return toCredentialRow(row);
}

function readCredentialById(
  db: SqliteDatabase,
  credentialId: string,
  providerId: string,
): CredentialRow | null {
  const row = db
    .prepare(
      'SELECT id, integration_id, value FROM credential WHERE id = ? AND integration_id = ? AND active = 1 LIMIT 1',
    )
    .get(credentialId, providerId);
  return toCredentialRow(row);
}

function toCredentialRow(row: Record<string, unknown> | undefined): CredentialRow | null {
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.integration_id !== 'string' ||
    typeof row.value !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    integrationId: row.integration_id,
    value: row.value,
  };
}

function parseCredential(raw: string): ParsedCredential {
  if (
    raw.length === 0 ||
    Buffer.byteLength(raw, 'utf8') > MAX_CREDENTIAL_VALUE_BYTES
  ) {
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_CREDENTIAL_INVALID',
      'OpenCode credential value is empty or exceeds the bounded credential size',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_CREDENTIAL_INVALID',
      'OpenCode credential value is not valid JSON',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_CREDENTIAL_INVALID',
      'OpenCode credential value has an invalid shape',
    );
  }

  const value = parsed as Record<string, unknown>;
  if (value.type !== 'oauth') {
    return { kind: 'other' };
  }

  if (
    typeof value.methodID !== 'string' ||
    value.methodID.length === 0 ||
    typeof value.access !== 'string' ||
    value.access.length === 0 ||
    typeof value.refresh !== 'string' ||
    value.refresh.length === 0 ||
    typeof value.expires !== 'number' ||
    !Number.isFinite(value.expires) ||
    value.expires <= 0
  ) {
    throw new OpenCodeCredentialStateError(
      'OPENCODE_OAUTH_CREDENTIAL_INVALID',
      'OpenCode OAuth credential is missing required bounded refresh metadata',
    );
  }

  return {
    kind: 'oauth',
    value: {
      type: 'oauth',
      methodID: value.methodID,
      access: value.access,
      refresh: value.refresh,
      expires: value.expires,
    },
  };
}

function sameOAuthCredential(a: OAuthValue, b: OAuthValue): boolean {
  return (
    a.methodID === b.methodID &&
    a.access === b.access &&
    a.refresh === b.refresh &&
    a.expires === b.expires
  );
}

function openDatabase(
  path: string,
  options?: { readonly readOnly?: boolean },
): SqliteDatabase {
  const sqlite = require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor };
  return options === undefined
    ? new sqlite.DatabaseSync(path)
    : new sqlite.DatabaseSync(path, options);
}

function closeQuietly(db: SqliteDatabase | null): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // Best-effort close only. No secret/error detail is emitted.
  }
}
