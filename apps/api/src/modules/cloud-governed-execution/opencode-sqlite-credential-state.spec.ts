import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OpenCodeCredentialStateError,
  syncRotatedOpenCodeOAuthCredential,
} from './opencode-sqlite-credential-state';

type SqliteStatement = {
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): { changes: number | bigint };
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

const DatabaseSync = (require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor })
  .DatabaseSync;

describe('OpenCode SQLite OAuth credential state', () => {
  let root: string;
  let sourceDb: string;
  let sessionDir: string;
  let sessionDb: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vito-opencode-oauth-state-'));
    sourceDb = join(root, 'source.db');
    sessionDir = join(root, 'session');
    sessionDb = join(sessionDir, '.local/share/opencode/opencode.db');
    mkdirSync(join(sessionDir, '.local/share/opencode'), { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('persists only a monotonic OAuth rotation into durable credential state', () => {
    createCredentialDb(
      sourceDb,
      oauth({
        access: 'access-before',
        refresh: 'refresh-before',
        expires: 1_000,
      }),
    );
    createCredentialDb(
      sessionDb,
      oauth({
        access: 'access-after',
        refresh: 'refresh-after',
        expires: 2_000,
      }),
      true,
    );

    const result = syncRotatedOpenCodeOAuthCredential({
      sourceDbPath: sourceDb,
      sessionDir,
      providerId: 'openai',
    });

    expect(result).toEqual({ updated: true });

    const db = new DatabaseSync(sourceDb, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT value FROM credential WHERE integration_id = 'openai' AND active = 1",
        )
        .get();
      expect(JSON.parse(String(row?.value))).toMatchObject({
        type: 'oauth',
        methodID: 'chatgpt-headless',
        access: 'access-after',
        refresh: 'refresh-after',
        expires: 2_000,
      });

      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_v2'",
        )
        .get();
      expect(table).toBeUndefined();

      const mode = db.prepare('PRAGMA journal_mode').get();
      expect(String(mode?.journal_mode).toLowerCase()).toBe('delete');
    } finally {
      db.close();
    }
  });

  it('does not rewrite durable state when OAuth credential did not rotate', () => {
    const value = oauth({
      access: 'access-same',
      refresh: 'refresh-same',
      expires: 2_000,
    });
    createCredentialDb(sourceDb, value);
    createCredentialDb(sessionDb, value);

    expect(
      syncRotatedOpenCodeOAuthCredential({
        sourceDbPath: sourceDb,
        sessionDir,
        providerId: 'openai',
      }),
    ).toEqual({ updated: false });
  });

  it('fails closed when changed OAuth state does not advance expiry', () => {
    createCredentialDb(
      sourceDb,
      oauth({
        access: 'access-before',
        refresh: 'refresh-before',
        expires: 2_000,
      }),
    );
    createCredentialDb(
      sessionDb,
      oauth({
        access: 'access-after',
        refresh: 'refresh-after',
        expires: 2_000,
      }),
    );

    expect(() =>
      syncRotatedOpenCodeOAuthCredential({
        sourceDbPath: sourceDb,
        sessionDir,
        providerId: 'openai',
      }),
    ).toThrow(
      expect.objectContaining<Partial<OpenCodeCredentialStateError>>({
        code: 'OPENCODE_OAUTH_ROTATION_NOT_MONOTONIC',
      }),
    );
  });

  it('fails closed when non-rotating OAuth metadata changes', () => {
    createCredentialDb(
      sourceDb,
      oauth({
        access: 'access-before',
        refresh: 'refresh-before',
        expires: 1_000,
      }),
    );
    createCredentialDb(
      sessionDb,
      JSON.stringify({
        type: 'oauth',
        methodID: 'chatgpt-headless',
        access: 'access-after',
        refresh: 'refresh-after',
        expires: 2_000,
        metadata: { accountID: 'different-account' },
      }),
    );

    expect(() =>
      syncRotatedOpenCodeOAuthCredential({
        sourceDbPath: sourceDb,
        sessionDir,
        providerId: 'openai',
      }),
    ).toThrow(
      expect.objectContaining<Partial<OpenCodeCredentialStateError>>({
        code: 'OPENCODE_OAUTH_CREDENTIAL_METADATA_CHANGED',
      }),
    );
  });

  it('fails closed when the authorized provider credential disappears', () => {
    createCredentialDb(
      sourceDb,
      oauth({
        access: 'access-before',
        refresh: 'refresh-before',
        expires: 1_000,
      }),
      false,
      'other-provider',
    );
    createCredentialDb(
      sessionDb,
      oauth({
        access: 'access-after',
        refresh: 'refresh-after',
        expires: 2_000,
      }),
      false,
      'other-provider',
    );

    expect(() =>
      syncRotatedOpenCodeOAuthCredential({
        sourceDbPath: sourceDb,
        sessionDir,
        providerId: 'openai',
      }),
    ).toThrow(
      expect.objectContaining<Partial<OpenCodeCredentialStateError>>({
        code: 'OPENCODE_OAUTH_SOURCE_CREDENTIAL_MISSING',
      }),
    );
  });

  it('leaves non-OAuth credentials unchanged', () => {
    const key = JSON.stringify({ type: 'key', key: 'not-returned-or-logged' });
    createCredentialDb(sourceDb, key);
    createCredentialDb(sessionDb, key);

    expect(
      syncRotatedOpenCodeOAuthCredential({
        sourceDbPath: sourceDb,
        sessionDir,
        providerId: 'openai',
      }),
    ).toEqual({ updated: false });
  });
});

function oauth(input: {
  access: string;
  refresh: string;
  expires: number;
}): string {
  return JSON.stringify({
    type: 'oauth',
    methodID: 'chatgpt-headless',
    access: input.access,
    refresh: input.refresh,
    expires: input.expires,
    metadata: { accountID: 'account-fixture' },
  });
}

function createCredentialDb(
  path: string,
  value: string,
  withSessionTable = false,
  providerId = 'openai',
): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE credential (
        id TEXT PRIMARY KEY,
        integration_id TEXT,
        label TEXT NOT NULL,
        value TEXT NOT NULL,
        connector_id TEXT,
        method_id TEXT,
        active INTEGER,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      );
    `);
    db.prepare(
      'INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated) VALUES (?, ?, ?, ?, 1, ?, ?)',
    ).run('cred-fixture', providerId, 'OpenAI', value, 100, 100);

    if (withSessionTable) {
      db.exec(`
        CREATE TABLE session_v2 (
          id TEXT PRIMARY KEY,
          title TEXT
        );
        INSERT INTO session_v2 (id, title) VALUES ('session-secret', 'must-not-persist');
      `);
    }
  } finally {
    db.close();
  }
}
