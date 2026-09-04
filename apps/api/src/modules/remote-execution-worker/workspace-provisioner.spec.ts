import { GitWorkspaceProvisioner, WorkspaceProvisionError } from './workspace-provisioner';
import type { RepositoryRegistry, WorkspaceHandle } from './types';

function makeRegistry(): RepositoryRegistry {
  return {
    resolve: jest.fn(),
    isBaseRefAllowed: jest.fn(),
  };
}

const VALID_REPO = {
  repositoryId: 'lavolpeofficial/vito-platform',
  cloneUrl: 'https://github.com/lavolpeofficial/vito-platform.git',
  allowedBaseRefs: ['refs/heads/develop'],
  registeredAt: new Date(),
  enabled: true,
};

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'org-123',
    workflowRunId: 'run-abc',
    repositoryId: 'lavolpeofficial/vito-platform',
    baseRef: 'refs/heads/develop',
    role: 'builder' as const,
    ...overrides,
  };
}

describe('GitWorkspaceProvisioner', () => {
  it('rejects unknown repositoryId', async () => {
    const registry = makeRegistry();
    (registry.resolve as jest.Mock).mockReturnValue(null);

    const provisioner = new GitWorkspaceProvisioner(registry, '/tmp/workspaces');
    await expect(provisioner.provision(baseRequest())).rejects.toThrow(
      /not in the trusted registry/,
    );
  });

  it('rejects disallowed base ref', async () => {
    const registry = makeRegistry();
    (registry.resolve as jest.Mock).mockReturnValue(VALID_REPO);
    (registry.isBaseRefAllowed as jest.Mock).mockReturnValue(false);

    const provisioner = new GitWorkspaceProvisioner(registry, '/tmp/workspaces');
    await expect(
      provisioner.provision(baseRequest({ baseRef: 'refs/heads/main' })),
    ).rejects.toThrow(/not in the allowed refs/);
  });

  it('rejects disabled repository', async () => {
    const registry = makeRegistry();
    (registry.resolve as jest.Mock).mockReturnValue(null);

    const provisioner = new GitWorkspaceProvisioner(registry, '/tmp/workspaces');
    await expect(provisioner.provision(baseRequest())).rejects.toThrow(
      /not in the trusted registry/,
    );
  });

  it('does not allow raw repository URL in request', async () => {
    const registry = makeRegistry();
    (registry.resolve as jest.Mock).mockReturnValue(null);

    const provisioner = new GitWorkspaceProvisioner(registry, '/tmp/workspaces');
    await expect(
      provisioner.provision(
        baseRequest({
          repositoryId: 'https://github.com/evil/owner.git',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects path traversal in workflowRunId', async () => {
    const registry = makeRegistry();
    (registry.resolve as jest.Mock).mockReturnValue(null);

    const provisioner = new GitWorkspaceProvisioner(registry, '/tmp/workspaces');
    const request = baseRequest({ workflowRunId: '../../etc/passwd' });

    await provisioner.provision(request).catch((err) => {
      expect(err).toBeInstanceOf(WorkspaceProvisionError);
    });
  });

  it('rejects path traversal in organizationId', async () => {
    const registry = makeRegistry();
    (registry.resolve as jest.Mock).mockReturnValue(null);

    const provisioner = new GitWorkspaceProvisioner(registry, '/tmp/workspaces');
    const request = baseRequest({ organizationId: '../../etc/passwd' });

    await provisioner.provision(request).catch((err) => {
      expect(err).toBeInstanceOf(WorkspaceProvisionError);
    });
  });

  it('validates resolved workspace path stays under workspaceRoot', async () => {
    const provisioner = new GitWorkspaceProvisioner(makeRegistry(), '/governed/root');
    const handle: WorkspaceHandle = Object.freeze({
      worktreePath: '/etc/passwd',
      baseSha: 'a'.repeat(40),
      role: 'builder',
      repositoryId: 'test/repo',
      createdAt: new Date(),
    });

    await expect(provisioner.cleanup(handle)).rejects.toThrow(
      /GOVERNED_WORKSPACE_ROOT/,
    );
  });
});
