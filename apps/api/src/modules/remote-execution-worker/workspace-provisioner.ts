import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { WorkspaceProvisionRequest, WorkspaceHandle, WorkspaceProvisioner, RepositoryRegistry } from './types';

const execFileAsync = promisify(execFile);

const SHA256_HEX_LENGTH = 64;

@Injectable()
export class GitWorkspaceProvisioner implements WorkspaceProvisioner {
  private readonly logger = new Logger(GitWorkspaceProvisioner.name);

  constructor(
    private readonly repositoryRegistry: RepositoryRegistry,
    private readonly workspaceRoot: string,
  ) {}

  async provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHandle> {
    this.logger.debug(
      `Provisioning workspace: repo=${request.repositoryId} ref=${request.baseRef} role=${request.role}`,
    );

    const repo = this.repositoryRegistry.resolve(request.repositoryId);
    if (!repo) {
      throw new WorkspaceProvisionError(
        'REPOSITORY_NOT_ALLOWED',
        `Repository '${request.repositoryId}' is not in the trusted registry`,
      );
    }

    if (!this.repositoryRegistry.isBaseRefAllowed(request.repositoryId, request.baseRef)) {
      throw new WorkspaceProvisionError(
        'BASE_REF_NOT_ALLOWED',
        `Base ref '${request.baseRef}' is not in the allowed refs for '${request.repositoryId}'`,
      );
    }

    const orgHash = sha256(request.organizationId);
    const worktreePath = join(
      this.workspaceRoot,
      'orgs',
      orgHash,
      'runs',
      request.workflowRunId,
      request.role,
    );

    mkdirSync(worktreePath, { recursive: true });

    const baseSha = await this.resolveRefToSha(repo.cloneUrl, request.baseRef);

    await this.createWorktree(repo.cloneUrl, worktreePath, baseSha);

    const handle: WorkspaceHandle = Object.freeze({
      worktreePath,
      baseSha,
      role: request.role,
      repositoryId: request.repositoryId,
      createdAt: new Date(),
    });

    this.logger.debug(
      `Workspace provisioned: ${worktreePath} at ${baseSha}`,
    );

    return handle;
  }

  async cleanup(handle: WorkspaceHandle): Promise<void> {
    this.logger.debug(`Cleaning up workspace: ${handle.worktreePath}`);

    if (!existsSync(handle.worktreePath)) {
      this.logger.debug(`Workspace already removed: ${handle.worktreePath}`);
      return;
    }

    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', handle.worktreePath], {
        timeout: 10_000,
      });
    } catch {
      this.logger.warn(`Failed to remove worktree: ${handle.worktreePath}`);
    }

    this.logger.debug(`Workspace cleaned: ${handle.worktreePath}`);
  }

  private async resolveRefToSha(cloneUrl: string, ref: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-remote', '--refs', cloneUrl, ref],
        { timeout: 30_000 },
      );

      const lines = stdout.trim().split('\n').filter(Boolean);
      if (lines.length === 0) {
        throw new WorkspaceProvisionError(
          'INVALID_BASE_REF',
          `Ref '${ref}' not found in remote repository`,
        );
      }

      const sha = lines[0].split(/\s+/)[0];
      if (!sha || sha.length !== 40 || !/^[0-9a-f]{40}$/i.test(sha)) {
        throw new WorkspaceProvisionError(
          'INVALID_BASE_REF',
          `Could not resolve ref '${ref}' to a valid SHA`,
        );
      }

      return sha;
    } catch (error) {
      if (error instanceof WorkspaceProvisionError) throw error;
      throw new WorkspaceProvisionError(
        'INVALID_BASE_REF',
        `Failed to resolve ref '${ref}': ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private async createWorktree(
    cloneUrl: string,
    worktreePath: string,
    sha: string,
  ): Promise<void> {
    const tmpGitDir = join(worktreePath, '.git');
    mkdirSync(worktreePath, { recursive: true });

    try {
      await execFileAsync('git', ['init', worktreePath], { timeout: 10_000 });
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'remote', 'add', 'origin', cloneUrl],
        { timeout: 10_000 },
      );
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'fetch', '--depth=1', 'origin', sha],
        { timeout: 60_000 },
      );
      await execFileAsync(
        'git',
        ['-C', worktreePath, 'checkout', 'FETCH_HEAD'],
        { timeout: 10_000 },
      );
    } catch (error) {
      throw new WorkspaceProvisionError(
        'WORKSPACE_PROVISION_FAILED',
        `Failed to create workspace: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export class WorkspaceProvisionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceProvisionError';
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
