import { captureGovernedResultSettling } from './change-set-capture';
import type { WorkspaceHandle } from './types';

jest.mock('node:child_process', () => {
  const actual = jest.requireActual('node:child_process');
  return {
    ...actual,
    execFile: jest.fn(),
  };
});

import { execFile } from 'node:child_process';

const mockExecFile = execFile as unknown as jest.Mock;

function makeWorkspace(
  overrides: Partial<WorkspaceHandle> = {},
): WorkspaceHandle {
  return {
    worktreePath: '/tmp/workspaces/org/run/builder',
    baseSha: 'a'.repeat(40),
    role: 'builder',
    repositoryId: 'lavolpeofficial/vito-platform',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('captureGovernedResultSettling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures changed file list from workspace with modifications', async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        if (args.includes('--porcelain')) {
          cb!(null, { stdout: ' M src/foo.ts\nA  src/bar.ts\n', stderr: '' });
        } else {
          cb!(null, { stdout: 'diff --git a/src/foo.ts', stderr: '' });
        }
      },
    );

    const workspace = makeWorkspace();
    const result = await captureGovernedResultSettling(workspace, 'exec-001');

    expect(result.changedFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(result.executionId).toBe('exec-001');
    expect(result.baseSha).toBe('a'.repeat(40));
    expect(result.empty).toBe(false);
  });

  it('captures bounded diff from workspace with modifications', async () => {
    const patchContent = 'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new';
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        if (args.includes('--porcelain')) {
          cb!(null, { stdout: ' M src/foo.ts\n', stderr: '' });
        } else {
          cb!(null, { stdout: patchContent, stderr: '' });
        }
      },
    );

    const result = await captureGovernedResultSettling(makeWorkspace(), 'exec-002');

    expect(result.patch).toBe(patchContent);
    expect(result.patchTruncated).toBe(false);
  });

  it('returns empty change-set for unchanged workspace', async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await captureGovernedResultSettling(makeWorkspace(), 'exec-003');

    expect(result.changedFiles).toEqual([]);
    expect(result.patch).toBe('');
    expect(result.empty).toBe(true);
  });

  it('handles git command failure gracefully (returns empty changedFiles)', async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        cb!(new Error('git not found'), { stdout: '', stderr: '' });
      },
    );

    const result = await captureGovernedResultSettling(makeWorkspace(), 'exec-004');

    expect(result.changedFiles).toEqual([]);
    expect(result.patch).toBe('');
    expect(result.empty).toBe(true);
  });

  it('returns executionId and baseSha from workspace', async () => {
    const baseSha = 'b'.repeat(40);
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await captureGovernedResultSettling(
      makeWorkspace({ baseSha }),
      'exec-005',
    );

    expect(result.executionId).toBe('exec-005');
    expect(result.baseSha).toBe(baseSha);
  });

  it('truncates oversized patch at MAX_PATCH_BYTES', async () => {
    const oversizedPatch = 'x'.repeat(2 * 1024 * 1024 + 100);
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        if (args.includes('--porcelain')) {
          cb!(null, { stdout: ' M src/foo.ts\n', stderr: '' });
        } else {
          cb!(null, { stdout: oversizedPatch, stderr: '' });
        }
      },
    );

    const result = await captureGovernedResultSettling(makeWorkspace(), 'exec-006');

    expect(result.patchTruncated).toBe(true);
    expect(Buffer.byteLength(result.patch, 'utf8')).toBe(2 * 1024 * 1024);
  });

  it('verifies patchTruncated=true when truncated', async () => {
    const oversizedPatch = 'y'.repeat(3 * 1024 * 1024);
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        if (args.includes('--porcelain')) {
          cb!(null, { stdout: ' M file.ts\n', stderr: '' });
        } else {
          cb!(null, { stdout: oversizedPatch, stderr: '' });
        }
      },
    );

    const result = await captureGovernedResultSettling(makeWorkspace(), 'exec-007');

    expect(result.patchTruncated).toBe(true);
    expect(result.empty).toBe(false);
  });

  it('returns frozen result object', async () => {
    mockExecFile.mockImplementation(
      (cmd: string, args: string[], opts: unknown, cb?: Function) => {
        if (typeof opts === 'function') cb = opts;
        cb!(null, { stdout: '', stderr: '' });
      },
    );

    const result = await captureGovernedResultSettling(makeWorkspace(), 'exec-008');
    expect(Object.isFrozen(result)).toBe(true);
  });
});
