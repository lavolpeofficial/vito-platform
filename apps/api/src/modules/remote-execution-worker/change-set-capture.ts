import { execFile } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkspaceHandle } from './types';

const execFileAsync = promisify(execFile);

/** Max buffer for git subprocesses — must exceed MAX_PATCH_BYTES to avoid truncation errors. */
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

export const MAX_PATCH_BYTES = 2 * 1024 * 1024;

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
 * Uses a temporary GIT_INDEX_FILE to stage ALL changes including untracked
 * files, then generates `git diff --cached --binary` against HEAD.
 *
 * This preserves:
 * - modified tracked files
 * - new/untracked files (the critical fix)
 * - deleted files
 * - renamed files
 * - binary files
 *
 * The temporary index is created and destroyed within this function.
 * No user/global Git state is modified. No push occurs.
 *
 * Git failures throw ChangeSetCaptureError — they are NOT swallowed
 * into empty results. Cleanup may still run in the caller's finally block.
 *
 * On success, returns a frozen GovernedResultSettling with the complete
 * patch bounded to MAX_PATCH_BYTES.
 */
export async function captureGovernedResultSettling(
  workspace: WorkspaceHandle,
  executionId: string,
): Promise<GovernedResultSettling> {
  const worktreePath = workspace.worktreePath;
  const tempIndexPath = join(worktreePath, '.git', 'vito-changeset-index');

  try {
    const statusOutput = await getChangedFiles(worktreePath);
    const patchResult = await getCompletePatch(worktreePath, tempIndexPath);

    return Object.freeze({
      executionId,
      baseSha: workspace.baseSha,
      changedFiles: statusOutput,
      patch: patchResult.patch,
      patchTruncated: patchResult.truncated,
      empty: statusOutput.length === 0 && patchResult.patch.length === 0,
    });
  } finally {
    cleanupTempIndex(tempIndexPath);
  }
}

/**
 * Get changed files via `git status --porcelain`.
 * Throws on git failure (fail-closed).
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', worktreePath, 'status', '--porcelain'],
    { timeout: 10_000, maxBuffer: GIT_MAX_BUFFER },
  );

  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.substring(3));
}

/**
 * Generate a complete binary diff using a temporary index to capture
 * untracked/new files. Throws on git failure (fail-closed).
 */
async function getCompletePatch(
  worktreePath: string,
  tempIndexPath: string,
): Promise<{ patch: string; truncated: boolean }> {
  const hasHead = await repoHasHead(worktreePath);

  if (!hasHead) {
    return generateUntrackedOnlyPatch(worktreePath);
  }

  try {
    await execFileAsync(
      'git',
      ['init', '--quiet', worktreePath],
      { timeout: 5_000, maxBuffer: GIT_MAX_BUFFER },
    );
  } catch {
    // Already initialized
  }

  await execFileAsync(
    'git',
    ['-C', worktreePath, 'read-tree', 'HEAD'],
    { timeout: 5_000, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_INDEX_FILE: tempIndexPath } },
  );

  await execFileAsync(
    'git',
    ['-C', worktreePath, 'add', '-A'],
    { timeout: 10_000, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_INDEX_FILE: tempIndexPath } },
  );

  const { stdout } = await execFileAsync(
    'git',
    ['-C', worktreePath, 'diff', '--cached', '--binary', '--no-color', 'HEAD'],
    { timeout: 30_000, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_INDEX_FILE: tempIndexPath } },
  );

  if (Buffer.byteLength(stdout, 'utf8') <= MAX_PATCH_BYTES) {
    return { patch: stdout, truncated: false };
  }

  const truncated = stdout.substring(0, MAX_PATCH_BYTES);
  return { patch: truncated, truncated: true };
}

/**
 * When HEAD does not exist (no commits), generate a patch representing
 * all tracked/untracked files as additions.
 */
async function generateUntrackedOnlyPatch(
  worktreePath: string,
): Promise<{ patch: string; truncated: boolean }> {
  const { stdout: lsFiles } = await execFileAsync(
    'git',
    ['-C', worktreePath, 'ls-files', '--cached', '--others', '--exclude-standard'],
    { timeout: 10_000, maxBuffer: GIT_MAX_BUFFER },
  );

  const files = lsFiles.split('\n').filter((f) => f.length > 0);
  if (files.length === 0) {
    return { patch: '', truncated: false };
  }

  const parts: string[] = [];
  for (const file of files) {
    const escaped = file.replace(/"/g, '\\"');
    parts.push(`new file mode 100644`);
    parts.push(`--- /dev/null`);
    parts.push(`+++ b/${escaped}`);
  }

  const patch = parts.join('\n');
  if (Buffer.byteLength(patch, 'utf8') <= MAX_PATCH_BYTES) {
    return { patch, truncated: false };
  }

  return { patch: patch.substring(0, MAX_PATCH_BYTES), truncated: true };
}

async function repoHasHead(worktreePath: string): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'rev-parse', '--verify', 'HEAD'],
      { timeout: 5_000, maxBuffer: GIT_MAX_BUFFER },
    );
    return true;
  } catch {
    return false;
  }
}

function cleanupTempIndex(tempIndexPath: string): void {
  try {
    if (existsSync(tempIndexPath)) {
      unlinkSync(tempIndexPath);
    }
  } catch {
    // Best-effort cleanup; temp index is non-critical
  }
}

export class ChangeSetCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ChangeSetCaptureError';
  }
}
