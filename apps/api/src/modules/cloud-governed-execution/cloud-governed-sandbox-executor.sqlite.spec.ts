import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudCredentialResolver } from './cloud-credential.resolver';
import { CloudGovernedSandboxExecutor } from './cloud-governed-sandbox-executor';
import type { SandboxExecutionRequest } from '../remote-execution-worker/types';

const MARKER = 'opencode-sqlite-v1';

describe('CloudGovernedSandboxExecutor OpenCode SQLite credential', () => {
  let root: string;
  let worktree: string;
  let fixture: string;
  let sourceDb: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vito-opencode-sqlite-'));
    worktree = join(root, 'worktree');
    mkdirSync(worktree, { recursive: true });
    fixture = join(root, 'fixture.js');
    sourceDb = join(root, 'source.db');
    writeFileSync(sourceDb, 'sqlite-fixture', { mode: 0o600 });
    writeFileSync(
      fixture,
      "const fs=require('node:fs');const p=process.env.XDG_DATA_HOME+'/opencode/opencode.db';process.stdout.write(fs.existsSync(p)?fs.readFileSync(p,'utf8'):'MISSING');",
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const request = (): SandboxExecutionRequest => ({
    workspace: {
      worktreePath: worktree,
      baseSha: 'b'.repeat(40),
      role: 'builder',
      repositoryId: 'lavolpeofficial/vito-platform',
      createdAt: new Date(),
    },
    executable: { resolvedPath: process.execPath, commandName: 'node', verifiedAt: new Date() },
    args: [fixture],
    credentialReference: 'cloud:sqlite',
    sandboxConfig: {
      technology: 'none',
      timeoutMs: 30_000,
      maxMemoryBytes: 0,
      maxCpuTimeMs: 0,
      maxWorktreeBytes: 0,
    },
  });

  it('copies the server-owned DB only into the ephemeral session and removes it after execution', async () => {
    const executor = new CloudGovernedSandboxExecutor(
      new CloudCredentialResolver(new Map([['cloud:sqlite', MARKER]])),
      root,
      'test',
      sourceDb,
    );
    const result = await executor.execute(request());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('sqlite-fixture');
    expect(existsSync(join(root, 'cloud-execution-sessions', 'runs'))).toBe(true);
    const runs = join(root, 'cloud-execution-sessions', 'runs');
    expect(require('node:fs').readdirSync(runs)).toHaveLength(0);
  });

  it('fails closed before spawn when the server-owned DB is unavailable', async () => {
    const executor = new CloudGovernedSandboxExecutor(
      new CloudCredentialResolver(new Map([['cloud:sqlite', MARKER]])),
      root,
      'test',
      join(root, 'missing.db'),
    );
    await expect(executor.execute(request())).rejects.toThrow(/SQLite credential source is unavailable/);
  });
});
