import { Injectable } from '@nestjs/common';
import type { CommandHandler, VitoCommand } from './command-bus.types';
import { WorldGitHubClient } from './world-github.client';

export interface WorldStatusSnapshot {
  system: 'WORLD';
  repository: string;
  branch: string;
  gate: string;
  caseId: string;
  verifier: string;
  triggeredAt: string;
  source: 'GITHUB_API';
}

@Injectable()
export class WorldStatusAdapter implements CommandHandler<WorldStatusSnapshot> {
  readonly commandType = 'WORLD.GET_STATUS';
  readonly target = 'WORLD';
  readonly requiredApprovalLevel = 'L0' as const;

  constructor(private readonly client: WorldGitHubClient) {}

  async execute(_command: VitoCommand): Promise<WorldStatusSnapshot> {
    const manifest = await this.client.getManifest();
    return {
      system: 'WORLD',
      repository: this.client.repository,
      branch: this.client.branch,
      gate: manifest.gate,
      caseId: manifest.caseId,
      verifier: manifest.verifier,
      triggeredAt: manifest.triggeredAt,
      source: 'GITHUB_API',
    };
  }
}
