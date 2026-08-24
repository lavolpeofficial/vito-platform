import { Module } from '@nestjs/common';

import { GovernedAdapterRegistry, ProviderType } from '@vito/contracts';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { GovernedInvocationServiceImpl } from '../governed-invocation/governed-invocation.service';
import { GovernedAdapterRegistryImpl } from '../governed-invocation/governed-adapter-registry';
import { PrismaGovernedIdempotencyStore } from './persistence/prisma-governed-idempotency.store';
import { WorkspaceFileToolAdapter } from './adapters/workspace-file.adapter';
import {
  GovernedHomeDirectoryResolver,
  GovernedWorkingDirectoryResolver,
  parseGovernedWorkspaceRoot,
} from './resolvers/governed-workspace.resolvers';
import { PrismaProviderDeclarationResolver } from './resolvers/prisma-provider-declaration.resolver';
import { TrustedExecutionPolicyResolver } from './resolvers/trusted-execution-policy.resolver';
import { TrustedExecutionProfileResolver } from './resolvers/trusted-execution-profile.resolver';
import { GovernedRuntimeService } from './governed-runtime.service';
import { GOVERNED_ADAPTER_REGISTRY, GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';

export { GOVERNED_ADAPTER_REGISTRY, GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';

@Module({
  imports: [AuditModule],
  providers: [
    {
      provide: GOVERNED_WORKSPACE_ROOT,
      useFactory: () => parseGovernedWorkspaceRoot(process.env.GOVERNED_WORKSPACE_ROOT),
    },
    TrustedExecutionProfileResolver,
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
      provide: GOVERNED_ADAPTER_REGISTRY,
      useFactory: (adapter: WorkspaceFileToolAdapter): GovernedAdapterRegistry => {
        const registry = new GovernedAdapterRegistryImpl();
        registry.register({
          providerType: ProviderType.DETERMINISTIC_TOOL,
          adapter,
          registeredAt: new Date(),
          version: 'b2c.1',
        });
        return registry;
      },
      inject: [WorkspaceFileToolAdapter],
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
          // B2c bewusste Deferred Dependencies (fail-closed belegt):
          credentialBroker: null,
          trustedExecutableResolver: null,
          humanGateResolver: null,
        }),
      inject: [
        PrismaProviderDeclarationResolver,
        GOVERNED_ADAPTER_REGISTRY,
        AuditService,
        TrustedExecutionProfileResolver,
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
