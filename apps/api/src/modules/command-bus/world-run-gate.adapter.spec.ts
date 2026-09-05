import { WorldRunGateAdapter } from './world-run-gate.adapter';
import type { VitoCommand } from './command-bus.types';

const contentsPayload = (manifest: Record<string, unknown>) => ({
  encoding: 'base64',
  content: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
});

describe('WorldRunGateAdapter', () => {
  const originalToken = process.env.VITO_GITHUB_TOKEN;
  const command: VitoCommand = {
    commandId: 'cmd-g35',
    commandType: 'WORLD.RUN_GATE',
    organizationId: 'org-1',
    requestedBy: 'jarvis',
    target: 'WORLD',
    parameters: { gate: 'G35' },
    approvalLevel: 'L3',
    correlationId: 'corr-g35',
    timestamp: new Date().toISOString(),
  };

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalToken === undefined) delete process.env.VITO_GITHUB_TOKEN;
    else process.env.VITO_GITHUB_TOKEN = originalToken;
  });

  it('dispatches the governed gate and returns its correlated workflow run', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    const now = new Date().toISOString();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => contentsPayload({
          gate: 'G35',
          caseId: 'WORLD-LOCATION-SELECTION',
          verifier: 'scripts/world-g35-verify.sh',
          triggeredAt: '2026-09-05T09:00:00Z',
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'head-sha' }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workflow_runs: [{
            id: 12345,
            name: 'WORLD Remote Governed Gate',
            path: '.github/workflows/world-remote-gate.yml',
            event: 'workflow_dispatch',
            status: 'queued',
            conclusion: null,
            head_branch: 'case/global-resilience-harvest-v0.1-agent',
            head_sha: 'head-sha',
            html_url: 'https://github.com/lavolpeofficial/aoe-knowledge-engine/actions/runs/12345',
            created_at: now,
            updated_at: now,
          }],
        }),
      } as Response);

    const result = await new WorldRunGateAdapter().execute(command);

    expect(result.dispatch).toBe('ACCEPTED');
    expect(result.gate).toBe('G35');
    expect(result.runId).toBe(12345);
    expect(result.headSha).toBe('head-sha');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });

  it('fails closed when the requested gate differs from the WORLD manifest', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => contentsPayload({
        gate: 'G34',
        caseId: 'WORLD-LOCATION-SELECTION',
        verifier: 'scripts/world-g34-verify.sh',
        triggeredAt: '2026-09-05T08:00:00Z',
      }),
    } as Response);

    await expect(new WorldRunGateAdapter().execute(command)).rejects.toThrow(
      'WORLD_GATE_NOT_GOVERNED:G34',
    );
  });

  it('requires an explicit GitHub credential for the private WORLD repository', async () => {
    delete process.env.VITO_GITHUB_TOKEN;
    await expect(new WorldRunGateAdapter().execute(command)).rejects.toThrow(
      'WORLD_GITHUB_TOKEN_MISSING',
    );
  });
});
