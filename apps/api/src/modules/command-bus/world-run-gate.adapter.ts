import { Injectable } from '@nestjs/common';
import type { CommandHandler, VitoCommand } from './command-bus.types';

interface WorldRunGateParameters {
  gate: string;
}

interface WorldGateManifest {
  gate: string;
  caseId: string;
  verifier: string;
  triggeredAt: string;
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
}

@Injectable()
export class WorldRunGateAdapter implements CommandHandler<WorldRunGateResult> {
  readonly commandType = 'WORLD.RUN_GATE';

  async execute(command: VitoCommand): Promise<WorldRunGateResult> {
    const { gate } = command.parameters as unknown as WorldRunGateParameters;
    if (typeof gate !== 'string' || !/^G[0-9]+$/.test(gate)) {
      throw new Error('WORLD_GATE_INVALID');
    }

    const repository = process.env.WORLD_REPOSITORY ?? 'lavolpeofficial/aoe-knowledge-engine';
    const branch = process.env.WORLD_BRANCH ?? 'case/global-resilience-harvest-v0.1-agent';
    const workflow = process.env.WORLD_GATE_WORKFLOW ?? 'world-remote-gate.yml';
    const token = process.env.VITO_GITHUB_TOKEN;
    if (!token) throw new Error('WORLD_GATE_GITHUB_TOKEN_MISSING');

    const manifestUrl = `https://raw.githubusercontent.com/${repository}/${branch}/ci/world-remote-gate.json`;
    const manifestResponse = await fetch(manifestUrl, { headers: { accept: 'application/json' } });
    if (!manifestResponse.ok) throw new Error(`WORLD_GATE_MANIFEST_HTTP_${manifestResponse.status}`);
    const manifest = (await manifestResponse.json()) as WorldGateManifest;

    if (manifest.gate !== gate) {
      throw new Error(`WORLD_GATE_NOT_GOVERNED:${manifest.gate}`);
    }
    if (manifest.caseId !== 'WORLD-LOCATION-SELECTION') {
      throw new Error('WORLD_GATE_CASE_NOT_ALLOWED');
    }
    if (!/^scripts\/world-g[0-9]+-verify\.sh$/.test(manifest.verifier)) {
      throw new Error('WORLD_GATE_VERIFIER_NOT_ALLOWED');
    }

    const dispatchUrl = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`;
    const dispatchResponse = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: branch }),
    });
    if (!dispatchResponse.ok) throw new Error(`WORLD_GATE_DISPATCH_HTTP_${dispatchResponse.status}`);

    return {
      system: 'WORLD',
      repository,
      branch,
      workflow,
      gate: manifest.gate,
      caseId: manifest.caseId,
      verifier: manifest.verifier,
      dispatch: 'ACCEPTED',
    };
  }
}
