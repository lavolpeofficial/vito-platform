import { Injectable } from '@nestjs/common';
import type { CommandHandler, VitoCommand } from './command-bus.types';

export interface WorldStatusSnapshot {
  system: 'WORLD';
  repository: string;
  branch: string;
  gate: string;
  caseId: string;
  verifier: string;
  triggeredAt: string;
  source: 'GITHUB_RAW';
}

@Injectable()
export class WorldStatusAdapter implements CommandHandler<WorldStatusSnapshot> {
  readonly commandType = 'WORLD.GET_STATUS';

  async execute(_command: VitoCommand): Promise<WorldStatusSnapshot> {
    const repository = process.env.WORLD_REPOSITORY ?? 'lavolpeofficial/aoe-knowledge-engine';
    const branch = process.env.WORLD_BRANCH ?? 'case/global-resilience-harvest-v0.1-agent';
    const url = `https://raw.githubusercontent.com/${repository}/${branch}/ci/world-remote-gate.json`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`WORLD_STATUS_HTTP_${response.status}`);
    const raw = (await response.json()) as Record<string, unknown>;
    for (const key of ['gate', 'caseId', 'verifier', 'triggeredAt']) {
      if (typeof raw[key] !== 'string' || raw[key] === '') throw new Error(`WORLD_STATUS_INVALID_${key}`);
    }
    return {
      system: 'WORLD', repository, branch,
      gate: raw.gate as string,
      caseId: raw.caseId as string,
      verifier: raw.verifier as string,
      triggeredAt: raw.triggeredAt as string,
      source: 'GITHUB_RAW',
    };
  }
}
