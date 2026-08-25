import { execFile } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { WorkspaceHandle } from './types';

const execFileAsync = promisify(execFile);

/** Max buffer for git subprocesses — must exceed MAX_PATCH_BYTES to avoid truncation errors. */
const GIT_MAX_BUFFER = 4 * 1024 * 1024;

export const MAX_PATCH_BYTES = 2 * 1024 * 1024;

export type ChangeSetCaptureErrorCode =
  | 'CHANGESET_CAPTURE_FAILED'
  | 'CHANGESET_TOO_LARGE';

export interface GovernedResultSettling {
  readonly executionId: string;
  readonly baseSha: string;
  readonly changedFiles: readonly string[];
  readonly patch: string;
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
 * Git failures throw ChangeSetCaptureError with typed code — they are NOT
 * swallowed into empty results. Cleanup may still run in the caller's
 * finally block.
 *
 * If the complete patch exceeds MAX_PATCH_BYTES, throws
 * ChangeSetCaptureError('CHANGESET_TOO_LARGE'). A partial patch is NOT
 * returned — it is not reconstructable and must not be treated as a
 * successful governed result.
 *
 * On success, returns a frozen GovernedResultSettling with the complete
 * patch. patchTruncated is removed — successful capture always has the
 * full patch.
 */
export async function captureGovernedResultSettling(
  workspace: WorkspaceHandle,
  executionId: string,
): Promise<GovernedResultSettling> {
  const worktreePath = workspace.worktreePath;
  const tempIndexPath = join(worktreePath, '.git', 'vito-changeset-index');

  try {
    const changedFiles = await getChangedFiles(worktreePath);
    const patch = await getCompletePatch(worktreePath, tempIndexPath);

    return Object.freeze({
      executionId,
      baseSha: workspace.baseSha,
      changedFiles,
      patch,
      empty: changedFiles.length === 0 && patch.length === 0,
    });
  } finally {
    cleanupTempIndex(tempIndexPath);
  }
}

/**
 * Get changed files via `git status --porcelain`.
 * Throws ChangeSetCaptureError('CHANGESET_CAPTURE_FAILED') on git failure.
 */
async function getChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'status', '--porcelain'],
      { timeout: 10_000, maxBuffer: GIT_MAX_BUFFER },
    );

    return stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => line.substring(3));
  } catch (error) {
    throw new ChangeSetCaptureError(
      'CHANGESET_CAPTURE_FAILED',
      `git status failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }
}

/**
 * Generate a complete binary diff using a temporary index to capture
 * untracked/new files. Throws ChangeSetCaptureError on git failure
 * or when the patch exceeds MAX_PATCH_BYTES.
 */
async function getCompletePatch(
  worktreePath: string,
  tempIndexPath: string,
): Promise<string> {
  const hasHead = await repoHasHead(worktreePath);

  if (!hasHead) {
    return getUntrackedOnlyPatch(worktreePath);
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

  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'read-tree', 'HEAD'],
      { timeout: 5_000, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_INDEX_FILE: tempIndexPath } },
    );
  } catch (error) {
    throw new ChangeSetCaptureError(
      'CHANGESET_CAPTURE_FAILED',
      `git read-tree HEAD failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }

  try {
    await execFileAsync(
      'git',
      ['-C', worktreePath, 'add', '-A'],
      { timeout: 10_000, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_INDEX_FILE: tempIndexPath } },
    );
  } catch (error) {
    throw new ChangeSetCaptureError(
      'CHANGESET_CAPTURE_FAILED',
      `git add -A failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }

  let fullPatch: string;
  try {
    ({ stdout: fullPatch } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'diff', '--cached', '--binary', '--no-color', 'HEAD'],
      { timeout: 30_000, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_INDEX_FILE: tempIndexPath } },
    ));
  } catch (error) {
    throw new ChangeSetCaptureError(
      'CHANGESET_CAPTURE_FAILED',
      `git diff --cached failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }

  const patchSize = Buffer.byteLength(fullPatch, 'utf8');
  if (patchSize > MAX_PATCH_BYTES) {
    throw new ChangeSetCaptureError(
      'CHANGESET_TOO_LARGE',
      `Generated patch is ${patchSize} bytes, exceeding MAX_PATCH_BYTES limit of ${MAX_PATCH_BYTES} bytes. ` +
        `The change-set is too large for v0.1 inline delivery. Retry with smaller scope.`,
    );
  }

  return fullPatch;
}

/**
 * When HEAD does not exist (no commits), generate a patch representing
 * all tracked/untracked files as additions.
 */
async function getUntrackedOnlyPatch(
  worktreePath: string,
): Promise<string> {
  let lsFiles: string;
  try {
    ({ stdout: lsFiles } = await execFileAsync(
      'git',
      ['-C', worktreePath, 'ls-files', '--cached', '--others', '--exclude-standard'],
      { timeout: 10_000, maxBuffer: GIT_MAX_BUFFER },
    ));
  } catch (error) {
    throw new ChangeSetCaptureError(
      'CHANGESET_CAPTURE_FAILED',
      `git ls-files failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined,
    );
  }

  const files = lsFiles.split('\n').filter((f) => f.length > 0);
  if (files.length === 0) {
    return '';
  }

  const parts: string[] = [];
  for (const file of files) {
    const escaped = file.replace(/"/g, '\\"');
    parts.push(`new file mode 100644`);
    parts.push(`--- /dev/null`);
    parts.push(`+++ b/${escaped}`);
  }

  const patch = parts.join('\n');
  const patchSize = Buffer.byteLength(patch, 'utf8');
  if (patchSize > MAX_PATCH_BYTES) {
    throw new ChangeSetCaptureError(
      'CHANGESET_TOO_LARGE',
      `Generated patch for untracked files is ${patchSize} bytes, exceeding MAX_PATCH_BYTES limit of ${MAX_PATCH_BYTES} bytes. ` +
        `The change-set is too large for v0.1 inline delivery. Retry with smaller scope.`,
    );
  }

  return patch;
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
    readonly code: ChangeSetCaptureErrorCode,
    message: string,
    readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ChangeSetCaptureError';
  }
}
