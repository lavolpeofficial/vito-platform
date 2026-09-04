import { Module } from '@nestjs/common';

import { GovernedAdapterRegistry, ProviderType } from '@vito/contracts';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { GovernedInvocationServiceImpl } from '../governed-invocation/governed-invocation.service';
import { GovernedAdapterRegistryImpl } from '../governed-invocation/governed-adapter-registry';
import { PrismaGovernedIdempotencyStore } from './persistence/prisma-governed-idempotency.store';
import { WorkspaceFileToolAdapter } from './adapters/workspace-file.adapter';
import { HeadlessLocalAgentAdapter } from './adapters/headless-local-agent.adapter';
import { CloudGovernedAgentAdapter } from './adapters/cloud-governed-agent.adapter';
import {
  GovernedHomeDirectoryResolver,
  GovernedWorkingDirectoryResolver,
} from './resolvers/governed-workspace.resolvers';
import { PrismaProviderDeclarationResolver } from './resolvers/prisma-provider-declaration.resolver';
import { TrustedExecutionPolicyResolver } from './resolvers/trusted-execution-policy.resolver';
import { TrustedExecutionProfileResolver } from './resolvers/trusted-execution-profile.resolver';
import { TrustedLocalExecutableResolver } from './resolvers/trusted-local-executable.resolver';
import { GovernedRuntimeService } from './governed-runtime.service';
import { GOVERNED_ADAPTER_REGISTRY, GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';
import { RemoteExecutionWorkerModule } from '../remote-execution-worker/remote-execution-worker.module';
import { RemoteExecutionWorkerService } from '../remote-execution-worker/remote-execution-worker.service';
import { GovernedWorkspaceConfigModule } from './governed-workspace-config.module';
import {
  CLOUD_EXECUTION_WORKER,
  CloudGovernedExecutionModule,
} from '../cloud-governed-execution/cloud-governed-execution.module';
import { CloudExecutionProfileRegistry } from '../cloud-governed-execution/cloud-execution-profile.registry';
import { CloudCredentialResolver } from '../cloud-governed-execution/cloud-credential.resolver';
import { CloudCredentialBroker } from '../cloud-governed-execution/cloud-credential.resolver';

export { GOVERNED_ADAPTER_REGISTRY, GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';

@Module({
  imports: [
    AuditModule,
    GovernedWorkspaceConfigModule,
    RemoteExecutionWorkerModule,
    CloudGovernedExecutionModule,
  ],
  providers: [
    TrustedExecutionProfileResolver,
    TrustedLocalExecutableResolver,
    {
      provide: TrustedExecutionPolicyResolver,
      useFactory: (workspaceRoot: string) => new TrustedExecutionPolicyResolver(workspaceRoot),
      inject: [GOVERNED_WORKSPACE_ROOT],
    },
    {
      provide: GovernedWorkingDirectoryResolver,
      useFactory: (workspaceRoot: string) => new GovernedWorkingDirectoryResolver(workspaceRoot),
      inject: [GOVERNED_WORKSPACE_ROOT],
    },
    {
      provide: GovernedHomeDirectoryResolver,
      useFactory: (workspaceRoot: string) => new GovernedHomeDirectoryResolver(workspaceRoot),
      inject: [GOVERNED_WORKSPACE_ROOT],
    },
    WorkspaceFileToolAdapter,
    {
      provide: HeadlessLocalAgentAdapter,
      inject: [RemoteExecutionWorkerService],
      useFactory: (workerService: RemoteExecutionWorkerService) =>
        new HeadlessLocalAgentAdapter(workerService),
    },
    {
      provide: CloudGovernedAgentAdapter,
      inject: [CLOUD_EXECUTION_WORKER, CloudExecutionProfileRegistry],
      useFactory: (
        cloudWorker: RemoteExecutionWorkerService,
        profileRegistry: CloudExecutionProfileRegistry,
      ) => new CloudGovernedAgentAdapter(cloudWorker, profileRegistry),
    },
    {
      provide: CloudCredentialBroker,
      inject: [PrismaProviderDeclarationResolver, CloudExecutionProfileRegistry, CloudCredentialResolver],
      useFactory: (
        providerResolver: PrismaProviderDeclarationResolver,
        profileRegistry: CloudExecutionProfileRegistry,
        credentialResolver: CloudCredentialResolver,
      ) => new CloudCredentialBroker(providerResolver, profileRegistry, credentialResolver),
    },
    {
      provide: GOVERNED_ADAPTER_REGISTRY,
      useFactory: (
        workspaceAdapter: WorkspaceFileToolAdapter,
        localAgentAdapter: HeadlessLocalAgentAdapter,
        cloudAgentAdapter: CloudGovernedAgentAdapter,
      ): GovernedAdapterRegistry => {
        const registry = new GovernedAdapterRegistryImpl();
        registry.register({
          providerType: ProviderType.DETERMINISTIC_TOOL,
          adapter: workspaceAdapter,
          registeredAt: new Date(),
          version: 'b2c.1',
        });
        registry.register({
          providerType: ProviderType.LOCAL_TOOL,
          adapter: localAgentAdapter,
          registeredAt: new Date(),
          version: 'agent-workforce.0.1',
        });
        registry.register({
          providerType: ProviderType.CLOUD_LLM,
          adapter: cloudAgentAdapter,
          registeredAt: new Date(),
          version: 'cloud-governed.0.2d',
        });
        return registry;
      },
      inject: [
        WorkspaceFileToolAdapter,
        HeadlessLocalAgentAdapter,
        CloudGovernedAgentAdapter,
      ],
    },
    PrismaProviderDeclarationResolver,
    PrismaGovernedIdempotencyStore,
    {
      provide: GovernedInvocationServiceImpl,
      useFactory: (
        providerResolver: PrismaProviderDeclarationResolver,
        adapterRegistry: GovernedAdapterRegistry,
        auditService: AuditService,
        executionProfileResolver: TrustedExecutionProfileResolver,
        trustedExecutableResolver: TrustedLocalExecutableResolver,
        workingDirectoryResolver: GovernedWorkingDirectoryResolver,
        homeDirectoryResolver: GovernedHomeDirectoryResolver,
        idempotencyStore: PrismaGovernedIdempotencyStore,
        executionPolicyResolver: TrustedExecutionPolicyResolver,
        credentialBroker: CloudCredentialBroker,
        cloudExecutionProfileRegistry: CloudExecutionProfileRegistry,
      ) =>
        new GovernedInvocationServiceImpl({
          providerResolver,
          adapterRegistry,
          auditService,
          executionProfileResolver,
          workingDirectoryResolver,
          homeDirectoryResolver,
          idempotencyStore,
          executionPolicyResolver,
          trustedExecutableResolver,
          credentialBroker,
          // Deliberately deferred until an approval resolver is durable.
          // Consequential human-gated actions continue to fail closed.
          humanGateResolver: null,
          cloudExecutionProfileRegistry,
        }),
      inject: [
        PrismaProviderDeclarationResolver,
        GOVERNED_ADAPTER_REGISTRY,
        AuditService,
        TrustedExecutionProfileResolver,
        TrustedLocalExecutableResolver,
        GovernedWorkingDirectoryResolver,
        GovernedHomeDirectoryResolver,
        PrismaGovernedIdempotencyStore,
        TrustedExecutionPolicyResolver,
        CloudCredentialBroker,
        CloudExecutionProfileRegistry,
      ],
    },
    GovernedRuntimeService,
  ],
  exports: [GovernedRuntimeService],
})
export class GovernedRuntimeModule {}
