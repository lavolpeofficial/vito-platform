import { WorldGateResultAdapter } from './world-gate-result.adapter';
import type { VitoCommand } from './command-bus.types';

describe('WorldGateResultAdapter', () => {
  const originalToken = process.env.VITO_GITHUB_TOKEN;
  const command: VitoCommand = {
    commandId: 'cmd-result-g35',
    commandType: 'WORLD.GET_GATE_RESULT',
    organizationId: 'org-1',
    requestedBy: 'jarvis',
    target: 'WORLD',
    parameters: { runId: 12345 },
    approvalLevel: 'L0',
    correlationId: 'corr-g35',
    timestamp: new Date().toISOString(),
  };

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalToken === undefined) delete process.env.VITO_GITHUB_TOKEN;
    else process.env.VITO_GITHUB_TOKEN = originalToken;
  });

  it('returns completed run state and artifacts for the governed WORLD workflow', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          name: 'WORLD Remote Governed Gate',
          path: '.github/workflows/world-remote-gate.yml',
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          head_branch: 'case/global-resilience-harvest-v0.1-agent',
          head_sha: 'head-sha',
          html_url: 'https://github.com/lavolpeofficial/aoe-knowledge-engine/actions/runs/12345',
          created_at: '2026-09-05T10:00:00Z',
          updated_at: '2026-09-05T10:01:00Z',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          artifacts: [{
            id: 77,
            name: 'world-G35-12345',
            size_in_bytes: 4096,
            expired: false,
            archive_download_url: 'https://api.github.com/repos/lavolpeofficial/aoe-knowledge-engine/actions/artifacts/77/zip',
            created_at: '2026-09-05T10:01:00Z',
            updated_at: '2026-09-05T10:01:00Z',
            expires_at: '2026-09-19T10:01:00Z',
          }],
        }),
      } as Response);

    const result = await new WorldGateResultAdapter().execute(command);
    expect(result.status).toBe('completed');
    expect(result.conclusion).toBe('success');
    expect(result.artifacts).toEqual([
      expect.objectContaining({ id: 77, name: 'world-G35-12345', expired: false }),
    ]);
  });

  it('does not expose artifacts until the run completes', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 12345,
        name: 'WORLD Remote Governed Gate',
        path: '.github/workflows/world-remote-gate.yml',
        event: 'workflow_dispatch',
        status: 'in_progress',
        conclusion: null,
        head_branch: 'case/global-resilience-harvest-v0.1-agent',
        head_sha: 'head-sha',
        html_url: 'https://github.com/lavolpeofficial/aoe-knowledge-engine/actions/runs/12345',
        created_at: '2026-09-05T10:00:00Z',
        updated_at: '2026-09-05T10:00:30Z',
      }),
    } as Response);

    const result = await new WorldGateResultAdapter().execute(command);
    expect(result.status).toBe('in_progress');
    expect(result.artifacts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed for a run outside the governed workflow', async () => {
    process.env.VITO_GITHUB_TOKEN = 'test-token';
    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 12345,
        path: '.github/workflows/ci.yml',
        event: 'workflow_dispatch',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'case/global-resilience-harvest-v0.1-agent',
        head_sha: 'head-sha',
        html_url: 'https://example.invalid',
        created_at: '2026-09-05T10:00:00Z',
        updated_at: '2026-09-05T10:01:00Z',
      }),
    } as Response);

    await expect(new WorldGateResultAdapter().execute(command)).rejects.toThrow(
      'WORLD_GATE_RUN_WORKFLOW_MISMATCH',
    );
  });
});
