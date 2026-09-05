import { WorldRunGateAdapter } from './world-run-gate.adapter';
import type { VitoCommand } from './command-bus.types';

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

  it('dispatches only the gate currently governed by WORLD', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gate: 'G35',
          caseId: 'WORLD-LOCATION-SELECTION',
          verifier: 'scripts/world-g35-verify.sh',
          triggeredAt: '2026-09-05T09:00:00Z',
        }),
      } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);

    const result = await new WorldRunGateAdapter().execute(command);

    expect(result.dispatch).toBe('ACCEPTED');
    expect(result.gate).toBe('G35');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  });

  it('fails closed when the requested gate differs from the WORLD manifest', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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

  it('requires an explicit GitHub execution credential', async () => {
    delete process.env.VITO_GITHUB_TOKEN;
    await expect(new WorldRunGateAdapter().execute(command)).rejects.toThrow(
      'WORLD_GATE_GITHUB_TOKEN_MISSING',
    );
  });
});
