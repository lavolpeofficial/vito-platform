import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import {
  REPOSITORY_REGISTRY,
  WORKSPACE_PROVISIONER,
  RemoteExecutionWorkerModule,
} from '../remote-execution-worker/remote-execution-worker.module';
import { RemoteExecutionWorkerService } from '../remote-execution-worker/remote-execution-worker.service';
import type { RepositoryRegistry, WorkspaceProvisioner } from '../remote-execution-worker/types';
import { GOVERNED_WORKSPACE_ROOT } from '../governed-runtime/governed-runtime.tokens';
import { GovernedWorkspaceConfigModule } from '../governed-runtime/governed-workspace-config.module';
import { CloudExecutionProfileRegistry } from './cloud-execution-profile.registry';
import { parseCloudExecutionProfilesFromEnv } from './cloud-execution-profile.registry';
import { CloudCredentialResolver } from './cloud-credential.resolver';
import { parseCloudCredentialsFromEnv } from './cloud-credential.resolver';
import { CloudGovernedSandboxExecutor } from './cloud-governed-sandbox-executor';

export const CLOUD_EXECUTION_WORKER = 'CLOUD_EXECUTION_WORKER';

/**
 * Cloud-governed execution assembly (OB-002D).
 *
 * Owns the server-owned profile/credential configuration and the dedicated
 * cloud worker instance. The cloud worker reuses the SAME authoritative
 * repository/baseRef registry and the SAME change-set capture/cleanup as the
 * local worker — only the sandbox executor is swapped for the ephemeral
 * cloud boundary. There is exactly ONE CLOUD_EXECUTION_WORKER and it is never
 * used by the LOCAL_ISOLATED tier.
 */
@Module({
  imports: [RemoteExecutionWorkerModule, GovernedWorkspaceConfigModule, PrismaModule],
  providers: [
    {
      provide: CloudExecutionProfileRegistry,
      useFactory: (): CloudExecutionProfileRegistry =>
        new CloudExecutionProfileRegistry(
          parseCloudExecutionProfilesFromEnv(process.env.VITO_CLOUD_EXECUTION_PROFILES),
        ),
    },
    {
      provide: CloudCredentialResolver,
      useFactory: (): CloudCredentialResolver =>
        new CloudCredentialResolver(
          parseCloudCredentialsFromEnv(process.env.VITO_CLOUD_AGENT_CREDENTIALS),
        ),
    },
    {
      provide: CloudGovernedSandboxExecutor,
      inject: [CloudCredentialResolver, GOVERNED_WORKSPACE_ROOT],
      useFactory: (
        resolver: CloudCredentialResolver,
        workspaceRoot: string,
      ): CloudGovernedSandboxExecutor =>
        new CloudGovernedSandboxExecutor(resolver, workspaceRoot),
    },
    {
      provide: CLOUD_EXECUTION_WORKER,
      inject: [REPOSITORY_REGISTRY, WORKSPACE_PROVISIONER, CloudGovernedSandboxExecutor],
      useFactory: (
        registry: RepositoryRegistry,
        provisioner: WorkspaceProvisioner,
        executor: CloudGovernedSandboxExecutor,
      ): RemoteExecutionWorkerService =>
        new RemoteExecutionWorkerService(registry, provisioner, executor),
    },
  ],
  exports: [
    CloudExecutionProfileRegistry,
    CloudCredentialResolver,
    CloudGovernedSandboxExecutor,
    CLOUD_EXECUTION_WORKER,
  ],
})
export class CloudGovernedExecutionModule {}