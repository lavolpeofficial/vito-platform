import { Injectable } from '@nestjs/common';
import type { CommandHandler, VitoCommand } from './command-bus.types';
import { WorldGitHubClient, type WorldWorkflowRun } from './world-github.client';

interface WorldRunGateParameters {
  gate: string;
}

export interface WorldRunGateResult {
  system: 'WORLD';
  repository: string;
  branch: string;
  workflow: string;
  gate: string;
  caseId: string;
  verifier: string;
  dispatch: 'ACCEPTED';
  runId: number;
  runUrl: string;
  runStatus: string;
  headSha: string;
}

@Injectable()
export class WorldRunGateAdapter implements CommandHandler<WorldRunGateResult> {
  readonly commandType = 'WORLD.RUN_GATE';
  readonly target = 'WORLD';
  readonly requiredApprovalLevel = 'L3' as const;

  async execute(command: VitoCommand): Promise<WorldRunGateResult> {
    const { gate } = command.parameters as unknown as WorldRunGateParameters;
    if (typeof gate !== 'string' || !/^G[0-9]+$/.test(gate)) throw new Error('WORLD_GATE_INVALID');

    const client = new WorldGitHubClient();
    const manifest = await client.getManifest();
    if (manifest.gate !== gate) throw new Error(`WORLD_GATE_NOT_GOVERNED:${manifest.gate}`);
    if (manifest.caseId !== 'WORLD-LOCATION-SELECTION') throw new Error('WORLD_GATE_CASE_NOT_ALLOWED');
    if (!/^scripts\/world-g[0-9]+-verify\.sh$/.test(manifest.verifier)) {
      throw new Error('WORLD_GATE_VERIFIER_NOT_ALLOWED');
    }

    const headSha = await client.getBranchHeadSha();
    const dispatchedAt = Date.now();
    await client.dispatchWorkflow();
    const run = await this.correlateRun(client, headSha, dispatchedAt);

    return {
      system: 'WORLD',
      repository: client.repository,
      branch: client.branch,
      workflow: client.workflow,
      gate: manifest.gate,
      caseId: manifest.caseId,
      verifier: manifest.verifier,
      dispatch: 'ACCEPTED',
      runId: run.id,
      runUrl: run.html_url,
      runStatus: run.status,
      headSha,
    };
  }

  private async correlateRun(
    client: WorldGitHubClient,
    headSha: string,
    dispatchedAt: number,
  ): Promise<WorldWorkflowRun> {
    const earliest = dispatchedAt - 5_000;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const runs = await client.listWorkflowRuns();
      const candidates = runs.filter((run) =>
        run.event === 'workflow_dispatch' &&
        run.head_branch === client.branch &&
        run.head_sha === headSha &&
        run.path.endsWith(`/${client.workflow}`) &&
        Date.parse(run.created_at) >= earliest,
      );
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) throw new Error('WORLD_GATE_RUN_CORRELATION_AMBIGUOUS');
      if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('WORLD_GATE_RUN_NOT_OBSERVED');
  }
}
