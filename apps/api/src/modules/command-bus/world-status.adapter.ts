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

  async execute(_command: VitoCommand): Promise<WorldStatusSnapshot> {
    const client = new WorldGitHubClient();
    const manifest = await client.getManifest();
    return {
      system: 'WORLD',
      repository: client.repository,
      branch: client.branch,
      gate: manifest.gate,
      caseId: manifest.caseId,
      verifier: manifest.verifier,
      triggeredAt: manifest.triggeredAt,
      source: 'GITHUB_API',
    };
  }
}
