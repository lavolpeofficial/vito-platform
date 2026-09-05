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

  async execute(command: VitoCommand): Promise<WorldGateResultSnapshot> {
    const { runId } = command.parameters as unknown as WorldGateResultParameters;
    if (!Number.isInteger(runId) || runId <= 0) throw new Error('WORLD_GATE_RUN_ID_INVALID');

    const client = new WorldGitHubClient();
    const run = await client.getWorkflowRun(runId);
    if (run.event !== 'workflow_dispatch') throw new Error('WORLD_GATE_RUN_EVENT_NOT_ALLOWED');
    if (run.head_branch !== client.branch) throw new Error('WORLD_GATE_RUN_BRANCH_MISMATCH');
    if (!run.path.endsWith(`/${client.workflow}`)) throw new Error('WORLD_GATE_RUN_WORKFLOW_MISMATCH');

    const artifacts = run.status === 'completed' ? await client.getWorkflowArtifacts(runId) : [];
    return {
      system: 'WORLD',
      repository: client.repository,
      branch: client.branch,
      workflow: client.workflow,
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
