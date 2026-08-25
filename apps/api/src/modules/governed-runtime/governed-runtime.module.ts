import { Module } from '@nestjs/common';

import { GovernedAdapterRegistry, ProviderType } from '@vito/contracts';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { GovernedInvocationServiceImpl } from '../governed-invocation/governed-invocation.service';
import { GovernedAdapterRegistryImpl } from '../governed-invocation/governed-adapter-registry';
import { PrismaGovernedIdempotencyStore } from './persistence/prisma-governed-idempotency.store';
import { WorkspaceFileToolAdapter } from './adapters/workspace-file.adapter';
import { HeadlessLocalAgentAdapter } from './adapters/headless-local-agent.adapter';
import {
  GovernedHomeDirectoryResolver,
  GovernedWorkingDirectoryResolver,
  parseGovernedWorkspaceRoot,
} from './resolvers/governed-workspace.resolvers';
import { PrismaProviderDeclarationResolver } from './resolvers/prisma-provider-declaration.resolver';
import { TrustedExecutionPolicyResolver } from './resolvers/trusted-execution-policy.resolver';
import { TrustedExecutionProfileResolver } from './resolvers/trusted-execution-profile.resolver';
import { TrustedLocalExecutableResolver } from './resolvers/trusted-local-executable.resolver';
import { GovernedRuntimeService } from './governed-runtime.service';
import { GOVERNED_ADAPTER_REGISTRY, GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';
import { RemoteExecutionWorkerModule } from '../remote-execution-worker/remote-execution-worker.module';
import { RemoteExecutionWorkerService } from '../remote-execution-worker/remote-execution-worker.service';

export { GOVERNED_ADAPTER_REGISTRY, GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';

@Module({
  imports: [AuditModule, RemoteExecutionWorkerModule],
  providers: [
    {
      provide: GOVERNED_WORKSPACE_ROOT,
      useFactory: () => parseGovernedWorkspaceRoot(process.env.GOVERNED_WORKSPACE_ROOT),
    },
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
      provide: GOVERNED_ADAPTER_REGISTRY,
      useFactory: (
        workspaceAdapter: WorkspaceFileToolAdapter,
        localAgentAdapter: HeadlessLocalAgentAdapter,
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
        return registry;
      },
      inject: [WorkspaceFileToolAdapter, HeadlessLocalAgentAdapter],
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
          // Deliberately deferred until a secret broker and approval resolver
          // are durable. Credential-requiring providers and consequential
          // actions continue to fail closed.
          credentialBroker: null,
          humanGateResolver: null,
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
      ],
    },
    GovernedRuntimeService,
  ],
  exports: [GovernedRuntimeService],
})
export class GovernedRuntimeModule {}
