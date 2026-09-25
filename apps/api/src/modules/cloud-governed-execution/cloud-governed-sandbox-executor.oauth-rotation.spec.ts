import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudCredentialResolver } from './cloud-credential.resolver';
import { CloudGovernedSandboxExecutor } from './cloud-governed-sandbox-executor';
import type { SandboxExecutionRequest } from '../remote-execution-worker/types';

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
const MARKER = 'opencode-sqlite-v1';

describe('CloudGovernedSandboxExecutor OAuth rotation persistence', () => {
  let root: string;
  let worktree: string;
  let sourceDb: string;
  let fixture: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vito-opencode-oauth-executor-'));
    worktree = join(root, 'worktree');
    sourceDb = join(root, 'state.db');
    fixture = join(root, 'rotate.js');
    mkdirSync(worktree, { recursive: true });

    createCredentialDb(
      sourceDb,
      JSON.stringify({
        type: 'oauth',
        methodID: 'chatgpt-headless',
        access: 'access-before',
        refresh: 'refresh-before',
        expires: 1_000,
      }),
    );

    writeFileSync(
      fixture,
      `
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(path.join(process.env.XDG_DATA_HOME,'opencode','opencode.db'));
const next=JSON.stringify({
  type:'oauth',
  methodID:'chatgpt-headless',
  access:'access-after',
  refresh:'refresh-after',
  expires:2000
});
db.prepare("UPDATE credential SET value=?, time_updated=? WHERE integration_id='openai' AND active=1").run(next,200);
db.close();
process.stderr.write('message=stream agent=build providerID=openai modelID=gpt-6-astra\\n');
process.stdout.write('ROTATED');
`,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('persists refreshed OAuth state before tearing down the ephemeral session', async () => {
    const executor = new CloudGovernedSandboxExecutor(
      new CloudCredentialResolver(new Map([['cloud:sqlite', MARKER]])),
      root,
      'test',
      sourceDb,
    );

    const request: SandboxExecutionRequest = {
      workspace: {
        worktreePath: worktree,
        baseSha: 'c'.repeat(40),
        role: 'builder',
        repositoryId: 'lavolpeofficial/vito-platform',
        createdAt: new Date(),
      },
      executable: {
        resolvedPath: process.execPath,
        commandName: 'node',
        verifiedAt: new Date(),
      },
      args: [fixture],
      credentialReference: 'cloud:sqlite',
      expectedProviderIdentity: {
        providerId: 'openai',
        allowedModelIds: ['gpt-6-astra'],
      },
      sandboxConfig: {
        technology: 'none',
        timeoutMs: 30_000,
        maxMemoryBytes: 0,
        maxCpuTimeMs: 0,
        maxWorktreeBytes: 0,
      },
    };

    const result = await executor.execute(request);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ROTATED');
    expect(result.providerIdentityError).toBeUndefined();
    expect(result.observedProviderIdentity).toEqual({
      providerId: 'openai',
      modelId: 'gpt-6-astra',
    });

    const db = new DatabaseSync(sourceDb, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT value FROM credential WHERE integration_id='openai' AND active=1",
        )
        .get();
      expect(JSON.parse(String(row?.value))).toMatchObject({
        access: 'access-after',
        refresh: 'refresh-after',
        expires: 2_000,
      });
    } finally {
      db.close();
    }

    const runs = join(root, 'cloud-execution-sessions', 'runs');
    expect(existsSync(runs)).toBe(true);
    expect(require('node:fs').readdirSync(runs)).toHaveLength(0);
  });

  it('does not persist rotated OAuth state when provider/model identity is unverified', async () => {
    writeFileSync(
      fixture,
      `
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(path.join(process.env.XDG_DATA_HOME,'opencode','opencode.db'));
const next=JSON.stringify({
  type:'oauth',
  methodID:'chatgpt-headless',
  access:'unverified-access',
  refresh:'unverified-refresh',
  expires:3000
});
db.prepare("UPDATE credential SET value=?, time_updated=? WHERE integration_id='openai' AND active=1").run(next,300);
db.close();
process.stdout.write('ROTATED_WITHOUT_IDENTITY');
`,
    );

    const executor = new CloudGovernedSandboxExecutor(
      new CloudCredentialResolver(new Map([['cloud:sqlite', MARKER]])),
      root,
      'test',
      sourceDb,
    );

    const result = await executor.execute({
      workspace: {
        worktreePath: worktree,
        baseSha: 'd'.repeat(40),
        role: 'builder',
        repositoryId: 'lavolpeofficial/vito-platform',
        createdAt: new Date(),
      },
      executable: {
        resolvedPath: process.execPath,
        commandName: 'node',
        verifiedAt: new Date(),
      },
      args: [fixture],
      credentialReference: 'cloud:sqlite',
      expectedProviderIdentity: {
        providerId: 'openai',
        allowedModelIds: ['gpt-6-astra'],
      },
      sandboxConfig: {
        technology: 'none',
        timeoutMs: 30_000,
        maxMemoryBytes: 0,
        maxCpuTimeMs: 0,
        maxWorktreeBytes: 0,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.providerIdentityError?.code).toBe('PROVIDER_IDENTITY_MISSING');

    const db = new DatabaseSync(sourceDb, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT value FROM credential WHERE integration_id='openai' AND active=1",
        )
        .get();
      expect(JSON.parse(String(row?.value))).toMatchObject({
        access: 'access-before',
        refresh: 'refresh-before',
        expires: 1_000,
      });
    } finally {
      db.close();
    }
  });
});

function createCredentialDb(path: string, value: string): void {
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
    ).run('cred-fixture', 'openai', 'OpenAI', value, 100, 100);
  } finally {
    db.close();
  }
}
