import { Injectable } from '@nestjs/common';
import type { CommandHandler, VitoCommand } from './command-bus.types';
import { WorldGitHubClient } from './world-github.client';

interface WorldGateResultParameters {
  runId: number;
}

export interface WorldGateResultSnapshot {
  system: 'WORLD';
  repository: string;
  branch: string;
  workflow: string;
  runId: number;
  runUrl: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  artifacts: Array<{
    id: number;
    name: string;
    sizeInBytes: number;
    expired: boolean;
    downloadUrl: string;
    expiresAt: string;
  }>;
}

@Injectable()
export class WorldGateResultAdapter implements CommandHandler<WorldGateResultSnapshot> {
  readonly commandType = 'WORLD.GET_GATE_RESULT';
  readonly target = 'WORLD';
  readonly requiredApprovalLevel = 'L0' as const;

  constructor(private readonly client: WorldGitHubClient) {}

  async execute(command: VitoCommand): Promise<WorldGateResultSnapshot> {
    const { runId } = command.parameters as unknown as WorldGateResultParameters;
    if (!Number.isInteger(runId) || runId <= 0) throw new Error('WORLD_GATE_RUN_ID_INVALID');

    const run = await this.client.getWorkflowRun(runId);
    if (run.event !== 'workflow_dispatch') throw new Error('WORLD_GATE_RUN_EVENT_NOT_ALLOWED');
    if (run.head_branch !== this.client.branch) throw new Error('WORLD_GATE_RUN_BRANCH_MISMATCH');
    if (!run.path.endsWith(`/${this.client.workflow}`)) throw new Error('WORLD_GATE_RUN_WORKFLOW_MISMATCH');

    const artifacts = run.status === 'completed' ? await this.client.getWorkflowArtifacts(runId) : [];
    return {
      system: 'WORLD',
      repository: this.client.repository,
      branch: this.client.branch,
      workflow: this.client.workflow,
      runId,
      runUrl: run.html_url,
      status: run.status,
      conclusion: run.conclusion,
      headSha: run.head_sha,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        sizeInBytes: artifact.size_in_bytes,
        expired: artifact.expired,
        downloadUrl: artifact.archive_download_url,
        expiresAt: artifact.expires_at,
      })),
    };
  }
}
