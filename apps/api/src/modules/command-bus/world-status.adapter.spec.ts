import { WorldStatusAdapter } from './world-status.adapter';
import type { VitoCommand } from './command-bus.types';

describe('WorldStatusAdapter', () => {
  const originalToken = process.env.VITO_GITHUB_TOKEN;
  const command: VitoCommand = {
    commandId: 'cmd-status',
    commandType: 'WORLD.GET_STATUS',
    organizationId: 'org-1',
    requestedBy: 'jarvis',
    target: 'WORLD',
    parameters: {},
    approvalLevel: 'L0',
    correlationId: 'corr-status',
    timestamp: new Date().toISOString(),
  };

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalToken === undefined) delete process.env.VITO_GITHUB_TOKEN;
    else process.env.VITO_GITHUB_TOKEN = originalToken;
  });

  it('reads the private WORLD manifest through the authenticated GitHub API', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    const manifest = {
      gate: 'G35',
      caseId: 'WORLD-LOCATION-SELECTION',
      verifier: 'scripts/world-g35-verify.sh',
      triggeredAt: '2026-09-05T09:00:00Z',
    };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
      }),
    } as Response);

    const result = await new WorldStatusAdapter().execute(command);
    expect(result).toMatchObject({ gate: 'G35', source: 'GITHUB_API' });

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer test-token');
  });
});
