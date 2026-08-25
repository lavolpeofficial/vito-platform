import { Module } from '@nestjs/common';
import { EnvRepositoryRegistry } from './repository-registry';
import { GitWorkspaceProvisioner } from './workspace-provisioner';
import { BubblewrapSandboxExecutor } from './sandbox-executor';
import { RemoteExecutionWorkerService } from './remote-execution-worker.service';
import type {
  RepositoryRegistry,
  WorkspaceProvisioner,
  SandboxExecutor,
} from './types';
import { GOVERNED_WORKSPACE_ROOT } from './tokens';

export const REPOSITORY_REGISTRY = 'REPOSITORY_REGISTRY';
export const WORKSPACE_PROVISIONER = 'WORKSPACE_PROVISIONER';
export const SANDBOX_EXECUTOR = 'SANDBOX_EXECUTOR';

@Module({
  providers: [
    {
      provide: REPOSITORY_REGISTRY,
      useFactory: (): RepositoryRegistry => new EnvRepositoryRegistry(),
    },
    {
      provide: GOVERNED_WORKSPACE_ROOT,
      useFactory: (): string => {
        const root = process.env.GOVERNED_WORKSPACE_ROOT;
        if (!root || root.trim().length === 0) {
          throw new Error('GOVERNED_WORKSPACE_ROOT environment variable is required');
        }
        return root;
      },
    },
    {
      provide: WORKSPACE_PROVISIONER,
      inject: [REPOSITORY_REGISTRY, GOVERNED_WORKSPACE_ROOT],
      useFactory: (registry: RepositoryRegistry, workspaceRoot: string): WorkspaceProvisioner =>
        new GitWorkspaceProvisioner(registry, workspaceRoot),
    },
    {
      provide: SANDBOX_EXECUTOR,
      useFactory: (): SandboxExecutor => new BubblewrapSandboxExecutor(),
    },
    {
      provide: RemoteExecutionWorkerService,
      inject: [REPOSITORY_REGISTRY, WORKSPACE_PROVISIONER, SANDBOX_EXECUTOR],
      useFactory: (
        registry: RepositoryRegistry,
        provisioner: WorkspaceProvisioner,
        executor: SandboxExecutor,
      ): RemoteExecutionWorkerService =>
        new RemoteExecutionWorkerService(registry, provisioner, executor),
    },
  ],
  exports: [
    RemoteExecutionWorkerService,
    REPOSITORY_REGISTRY,
    WORKSPACE_PROVISIONER,
    SANDBOX_EXECUTOR,
  ],
})
export class RemoteExecutionWorkerModule {}
