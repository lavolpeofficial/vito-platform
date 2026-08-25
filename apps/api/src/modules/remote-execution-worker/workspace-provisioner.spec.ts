import { EnvRepositoryRegistry } from './repository-registry';
import { GitWorkspaceProvisioner, WorkspaceProvisionError } from './workspace-provisioner';
import type { RepositoryRegistry, WorkspaceProvisionRequest } from './types';

describe('GitWorkspaceProvisioner', () => {
  const VITO_REPO = 'lavolpeofficial/vito-platform';
  const WORKSPACE_ROOT = '/tmp/test-workspaces';

  function makeRegistry(overrides: Partial<{ enabled: boolean; allowedBaseRefs: string[] }> = {}): RepositoryRegistry {
    return new EnvRepositoryRegistry(
      JSON.stringify([
        {
          repositoryId: VITO_REPO,
          cloneUrl: 'git@github.com:lavolpeofficial/vito-platform.git',
          allowedBaseRefs: ['main', 'develop'],
          enabled: true,
          ...overrides,
        },
      ]),
    );
  }

  function makeRequest(overrides: Partial<WorkspaceProvisionRequest> = {}): WorkspaceProvisionRequest {
    return {
      organizationId: 'org-123',
      workflowRunId: 'run-456',
      repositoryId: VITO_REPO,
      baseRef: 'main',
      role: 'builder',
      ...overrides,
    };
  }

  it('rejects unknown repositoryId', async () => {
    const registry = makeRegistry();
    const provisioner = new GitWorkspaceProvisioner(registry, WORKSPACE_ROOT);

    await expect(
      provisioner.provision(makeRequest({ repositoryId: 'unknown/repo' })),
    ).rejects.toThrow(WorkspaceProvisionError);
  });

  it('rejects disallowed base ref', async () => {
    const registry = makeRegistry();
    const provisioner = new GitWorkspaceProvisioner(registry, WORKSPACE_ROOT);

    await expect(
      provisioner.provision(makeRequest({ baseRef: 'refs/heads/main' })),
    ).rejects.toThrow(WorkspaceProvisionError);
  });

  it('rejects disabled repository', async () => {
    const registry = makeRegistry({ enabled: false });
    const provisioner = new GitWorkspaceProvisioner(registry, WORKSPACE_ROOT);

    await expect(
      provisioner.provision(makeRequest()),
    ).rejects.toThrow(WorkspaceProvisionError);
  });

  it('does not allow raw repository URL in request', async () => {
    const registry = makeRegistry();
    const provisioner = new GitWorkspaceProvisioner(registry, WORKSPACE_ROOT);

    await expect(
      provisioner.provision(
        makeRequest({
          repositoryId: 'git@github.com:attacker/evil.git',
        }),
      ),
    ).rejects.toThrow(WorkspaceProvisionError);
  });
});
