import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { randomUUID } from 'crypto';
import type {
  GovernedAdapterRequest,
  GovernedAdapterResult,
  GovernedExecutionContext,
} from '@vito/contracts';
import { AgentExecutionStatus, ExecutionAction, ProviderType } from '@vito/contracts';
import { WorkspaceFileToolAdapter } from './workspace-file.adapter';

/**
 * Fokussierte B2b-Tests: WorkspaceFileToolAdapter.
 *
 * Der Adapter betreibt ausschließlich innerhalb von
 * context.environment.workingDirectory, leitet die Autorität NIEMALS aus
 * request-Daten ab und entscheidet NIEMALS Policy. Adversariale Tests:
 * Traversal, Absolute-Path-Escape, Symlink-Escape (Read/Create/Write),
* Tenant-Isolation, Inhalts-Bounds, kooperative Timeout-Rückgabe.
 */

function makeContext(overrides: Partial<GovernedExecutionContext> & { workingDirectory: string }): GovernedExecutionContext {
  const { workingDirectory, ...rest } = overrides;
  return {
    invocationId: randomUUID(),
    organizationId: 'org-1',
    workflowRunId: 'run-1',
    workflowStepRunId: 'step-1',
    correlationId: 'corr-1',
    capabilityCode: 'CODE_BUILD',
    providerId: 'provider-1',
    providerType: ProviderType.DETERMINISTIC_TOOL,
    executionProfile: 'BUILDER' as never,
    executionBudget: {},
    policyDecision: {
      allowed: true,
      executionProfile: 'BUILDER',
      requestedAction: ExecutionAction.CREATE_FILE,
      reasonCode: 'ALLOWED_WITHIN_ROOT',
      reason: 'test',
      policyVersion: 'eo-01.4-v1',
      evaluatedAt: new Date(),
    },
    environment: { allowlist: new Map(), workingDirectory },
    startedAt: new Date(Date.now() - 5),
    timeoutMs: 10_000,
    ...rest,
  } as GovernedExecutionContext;
}

const OUTSIDE_SENTINEL = 'OUTSIDE-CONTENT-SENTINEL';

describe('WorkspaceFileToolAdapter', () => {
  let adapter: WorkspaceFileToolAdapter;
  let workspace: string;
  let outsideDir: string;

  beforeEach(async () => {
    adapter = new WorkspaceFileToolAdapter();
    const base = await mkdtemp(join(tmpdir(), 'vito-b2b-filetool-'));
    workspace = join(base, 'workspace');
    outsideDir = join(base, 'outside');
    await mkdir(workspace, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.txt'), OUTSIDE_SENTINEL);
  });

  afterEach(async () => {
    await rm(join(workspace, '..'), { recursive: true, force: true });
  });

  const run = (
    context: GovernedExecutionContext,
    request: GovernedAdapterRequest = {},
  ): Promise<GovernedAdapterResult> => adapter.execute(request, context);

  it('exposes the deterministic tool provider type and only file actions are meaningful to it', () => {
    expect(adapter.providerType).toBe(ProviderType.DETERMINISTIC_TOOL);
  });

  it('adversarial 1: ../ traversal is denied', async () => {
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: '../escaped.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'x' } },
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('PATH_ESCAPE');
    expect(existsSync(join(outsideDir, 'escaped.txt'))).toBe(false);
  });

  it('adversarial 2: absolute path outside root is denied', async () => {
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.READ_FILE,
          requestedPath: join(outsideDir, 'secret.txt'),
        } as never,
      }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('PATH_ESCAPE');
  });

  it('adversarial 3: normalized path cannot escape via inner .. segments', async () => {
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: 'sub/../../escaped.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'x' } },
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('PATH_ESCAPE');
    expect(existsSync(join(workspace, '..', 'escaped.txt'))).toBe(false);
  });

  it('adversarial 4: symlink inside workspace pointing outside is denied for READ_FILE', async () => {
    await symlink(join(outsideDir, 'secret.txt'), join(workspace, 'leak.txt'));
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.READ_FILE,
          requestedPath: 'leak.txt',
        } as never,
      }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(['PATH_ESCAPE', 'SYMLINK_ESCAPE']).toContain((result.error as { code: string }).code);
    expect(JSON.stringify(result)).not.toContain(OUTSIDE_SENTINEL);
  });

  it('adversarial 5: CREATE_FILE cannot create through an escaping symlink parent', async () => {
    await symlink(outsideDir, join(workspace, 'escape-dir'));
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: `escape-dir${sep}planted.txt`,
        } as never,
      }),
      { governedInputPayload: { content: 'planted' } },
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(['PATH_ESCAPE', 'SYMLINK_ESCAPE']).toContain((result.error as { code: string }).code);
    expect(existsSync(join(outsideDir, 'planted.txt'))).toBe(false);
  });

  it('adversarial 6: WRITE_FILE cannot overwrite outside the workspace via symlink', async () => {
    await symlink(join(outsideDir, 'secret.txt'), join(workspace, 'victim.txt'));
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.WRITE_FILE,
          requestedPath: 'victim.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'OVERWRITTEN' } },
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(['PATH_ESCAPE', 'SYMLINK_ESCAPE']).toContain((result.error as { code: string }).code);
    await expect(readFile(join(outsideDir, 'secret.txt'), 'utf8')).resolves.toBe(OUTSIDE_SENTINEL);
  });

  it('adversarial 7: valid nested path inside the workspace succeeds end-to-end (CREATE then READ)', async () => {
    await mkdir(join(workspace, 'nested', 'deep'), { recursive: true });
    const createResult = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: 'nested/deep/probe.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'governed-content' } },
    );
    expect(createResult.status).toBe(AgentExecutionStatus.SUCCEEDED);
    expect(createResult.artifactReferences).toEqual(['gov://workspace/nested/deep/probe.txt']);
    expect(createResult.providerExecutionMetadata.sideEffects).toEqual({
      filesCreated: ['nested/deep/probe.txt'],
      filesModified: [],
      filesDeleted: [],
      commandsExecuted: [],
    });
    await expect(readFile(join(workspace, 'nested', 'deep', 'probe.txt'), 'utf8')).resolves.toBe(
      'governed-content',
    );

    const readResult = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.READ_FILE,
          requestedPath: 'nested/deep/probe.txt',
        } as never,
      }),
    );
    expect(readResult.status).toBe(AgentExecutionStatus.SUCCEEDED);
    expect(readResult.outputReference).toBe('gov://workspace/nested/deep/probe.txt');
    // No raw content channel: contents never enter result/metadata.
    expect(JSON.stringify(readResult)).not.toContain('governed-content');
  });

  it('adversarial 8: two tenant workspaces remain isolated', async () => {
    const secondWorkspace = join(await mkdtemp(join(tmpdir(), 'vito-b2b-second-')), 'workspace');
    try {
      await mkdir(secondWorkspace, { recursive: true });
      await run(
        makeContext({
          workingDirectory: workspace,
          policyDecision: {
            allowed: true,
            requestedAction: ExecutionAction.CREATE_FILE,
            requestedPath: 'tenant-a.txt',
          } as never,
        }),
        { governedInputPayload: { content: 'tenant-A-data' } },
      );
      const crossRead = await run(
        makeContext({
          organizationId: 'org-2',
          workingDirectory: secondWorkspace,
          policyDecision: {
            allowed: true,
            requestedAction: ExecutionAction.READ_FILE,
            requestedPath: 'tenant-a.txt',
          } as never,
        }),
      );
      expect(crossRead.status).toBe(AgentExecutionStatus.FAILED);
      expect((crossRead.error as { code: string }).code).toBe('FILE_NOT_FOUND');
      expect(JSON.stringify(crossRead)).not.toContain('tenant-A-data');
    } finally {
      await rm(join(secondWorkspace, '..'), { recursive: true, force: true });
    }
  });

  it('unsupported actions are refused without executing anything', async () => {
    for (const action of [
      ExecutionAction.DELETE_FILE,
      ExecutionAction.RUN_COMMAND,
      ExecutionAction.GIT_PUSH,
      ExecutionAction.NETWORK_ACCESS,
    ]) {
      const result = await run(
        makeContext({
          workingDirectory: workspace,
          policyDecision: { allowed: true, requestedAction: action, requestedPath: 'x' } as never,
        }),
      );
      expect(result.status).toBe(AgentExecutionStatus.FAILED);
      expect((result.error as { code: string }).code).toBe('UNSUPPORTED_ACTION');
    }
    expect(existsSync(join(workspace, 'x'))).toBe(false);
  });

  it('missing requestedPath fails closed for file actions', async () => {
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: { allowed: true, requestedAction: ExecutionAction.READ_FILE } as never,
      }),
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('TARGET_PATH_REQUIRED');
  });

  it('CREATE_FILE refuses to clobber an existing file (exclusive creation)', async () => {
    await writeFile(join(workspace, 'exists.txt'), 'original');
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: 'exists.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'new' } },
    );
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect((result.error as { code: string }).code).toBe('FILE_ALREADY_EXISTS');
    await expect(readFile(join(workspace, 'exists.txt'), 'utf8')).resolves.toBe('original');
  });

  it('WRITE_FILE requires an existing file and modifies it in place', async () => {
    const missing = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.WRITE_FILE,
          requestedPath: 'ghost.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'x' } },
    );
    expect((missing.error as { code: string }).code).toBe('FILE_NOT_FOUND');

    await writeFile(join(workspace, 'target.txt'), 'old');
    const modified = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.WRITE_FILE,
          requestedPath: 'target.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'new-body' } },
    );
    expect(modified.status).toBe(AgentExecutionStatus.SUCCEEDED);
    expect(modified.providerExecutionMetadata.sideEffects).toMatchObject({
      filesModified: ['target.txt'],
    });
    await expect(readFile(join(workspace, 'target.txt'), 'utf8')).resolves.toBe('new-body');
  });

  it('non-string or oversized content payloads fail closed', async () => {
    const nonString = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: 'bad.txt',
        } as never,
      }),
      { governedInputPayload: { content: 42 } },
    );
    expect(nonString.status).toBe(AgentExecutionStatus.FAILED);
    expect((nonString.error as { code: string }).code).toBe('INVALID_CONTENT');

    const oversized = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.CREATE_FILE,
          requestedPath: 'big.txt',
        } as never,
      }),
      { governedInputPayload: { content: 'x'.repeat(1024 * 1024 + 1) } },
    );
    expect(oversized.status).toBe(AgentExecutionStatus.FAILED);
    expect((oversized.error as { code: string }).code).toBe('CONTENT_TOO_LARGE');
    expect(existsSync(join(workspace, 'big.txt'))).toBe(false);
  });

  it('honors the cooperative timeout boundary while EO-01.5 stays authoritative', async () => {
    const startedAt = new Date(Date.now() - 60_000);
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        startedAt,
        timeoutMs: 1_000,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.READ_FILE,
          requestedPath: 'whatever.txt',
        } as never,
      }),
    );
    expect(result.status).toBe(AgentExecutionStatus.TIMED_OUT);
    expect((result.error as { code: string }).code).toBe('ADAPTER_TIMEOUT');
  });

  it('governed references always match the frozen sanitizer grammar', async () => {
    const result = await run(
      makeContext({
        workingDirectory: workspace,
        policyDecision: {
          allowed: true,
          requestedAction: ExecutionAction.WRITE_FILE,
          requestedPath: 'ref-check.txt',
        } as never,
      }),
      { governedInputPayload: { content: '' } },
    );
    const refs = [
      ...(result.artifactReferences ?? []),
      ...(result.outputReference ? [result.outputReference] : []),
    ];
    for (const ref of refs) {
      expect(ref).toMatch(/^gov:\/\/[A-Za-z0-9._~:/?#%-]+$/);
      expect(ref.length).toBeLessThanOrEqual(512);
    }
  });

  it('adapter never spawns processes or touches the network (static import hygiene)', () => {
    const fs = require('fs');
    const source = fs.readFileSync(__filename.replace(/\.spec\.ts$/, '.ts'), 'utf8');
    expect(source).not.toMatch(/child_process/);
    expect(source).not.toMatch(/require\(/);
    expect(source).not.toMatch(/http[s]?:\/\//);
    expect(source).not.toMatch(/\beval\b/);
  });
});
