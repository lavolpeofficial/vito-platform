import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceHandle } from './types';

const execFileAsync = promisify(execFile);

const MAX_PATCH_BYTES = 2 * 1024 * 1024;

export interface GovernedResultSettling {
  readonly executionId: string;
  readonly baseSha: string;
  readonly changedFiles: readonly string[];
  readonly patch: string;
  readonly patchTruncated: boolean;
  readonly empty: boolean;
}

/**
 * Capture a governed change-set from a workspace BEFORE cleanup.
 *
 * Runs `git status --porcelain` and `git diff --binary` in the worktree.
 * The patch is bounded to MAX_PATCH_BYTES; if truncated, patchTruncated=true.
 * An unchanged workspace produces an empty change-set (empty=true, changedFiles=[], patch='').
 */
export async function captureGovernedResultSettling(
  workspace: WorkspaceHandle,
  executionId: string,
): Promise<GovernedResultSettling> {
  const changedFiles = await getChangedFiles(workspace.worktreePath);
  const patchResult = await getBoundedPatch(workspace.worktreePath);

  return Object.freeze({
    executionId,
    baseSha: workspace.baseSha,
    changedFiles,
    patch: patchResult.patch,
    patchTruncated: patchResult.truncated,
    empty: changedFiles.length === 0 && patchResult.patch.length === 0,
  });
}

async function getChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'status', '--porcelain'],
      { timeout: 10_000 },
    );

    return stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.substring(3));
  } catch {
    return [];
  }
}

async function getBoundedPatch(
  worktreePath: string,
): Promise<{ patch: string; truncated: boolean }> {
  try {
    const { stdout: fullPatch } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'diff', '--binary', '--no-color'],
      { timeout: 30_000 },
    );

    if (Buffer.byteLength(fullPatch, 'utf8') <= MAX_PATCH_BYTES) {
      return { patch: fullPatch, truncated: false };
    }

    const truncated = fullPatch.substring(0, MAX_PATCH_BYTES);
    return { patch: truncated, truncated: true };
  } catch {
    return { patch: '', truncated: false };
  }
}
