import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GovernedInvocationServiceImpl } from '../governed-invocation/governed-invocation.service';
import {
  ExecutionAction,
  ExecutionProfile,
  GovernedAdapterRegistry,
  ProviderCredentialRequirement,
  ProviderDeclaration,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderStatus,
  ProviderType,
} from '@vito/contracts';
import { GovernedAdapterRegistryImpl } from '../governed-invocation/governed-adapter-registry';
import { PrismaGovernedIdempotencyStore } from './persistence/prisma-governed-idempotency.store';
import { TrustedExecutionProfileResolver } from './resolvers/trusted-execution-profile.resolver';
import { TrustedExecutionPolicyResolver } from './resolvers/trusted-execution-policy.resolver';
import {
  GovernedHomeDirectoryResolver,
  GovernedWorkingDirectoryResolver,
  governedOrgDirectoryName,
} from './resolvers/governed-workspace.resolvers';
import { WorkspaceFileToolAdapter } from './adapters/workspace-file.adapter';
import {
  GovernedRuntimeService,
  TRUSTED_RUNTIME_ORIGIN,
  TrustedGovernedWorkspaceFileOperation,
} from './governed-runtime.service';
import type {
  GovernedInvocationClaimResult,
  GovernedInvocationClaimState,
  GovernedInvocationIdempotencyStore,
} from '@vito/contracts';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function makeDeclaration(overrides?: Partial<ProviderDeclaration>): ProviderDeclaration {
  return {
    id: randomUUID(),
    organizationId: ORG_A,
    providerCode: 'workspace-tool',
    displayName: 'Workspace File Tool',
    providerType: ProviderType.DETERMINISTIC_TOOL,
    status: ProviderStatus.ACTIVE,
    supportedCapabilities: [],
    capabilityAssignments: [{ capabilityCode: 'CODE_BUILD', isEnabled: true }],
    estimatedCostMinorUnits: null,
    healthStatus: ProviderHealthStatus.HEALTHY,
    quotaStatus: ProviderQuotaStatus.AVAILABLE,
    costMetadata: {},
    assuranceLevels: [],
    metadata: {},
    credentialRequirement: ProviderCredentialRequirement.NOT_REQUIRED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Test-only in-memory store mirroring the frozen claim semantics (single process). */
class InMemoryIdempotencyStore implements GovernedInvocationIdempotencyStore {
  readonly claims = new Map<
    string,
    {
      invocationId: string;
      contextFingerprint: string;
      state: GovernedInvocationClaimState | 'IN_PROGRESS';
    }
  >();
  markCompleted = jest.fn(
    async (
      logicalOperationKey: string,
      _invocationId: string,
      state: GovernedInvocationClaimState,
    ): Promise<void> => {
      const existing = this.claims.get(logicalOperationKey);
      if (!existing || existing.state !== 'IN_PROGRESS') return;
      existing.state = state;
    },
  );

  async claim(
    logicalOperationKey: string,
    invocationId: string,
    contextFingerprint: string,
  ): Promise<GovernedInvocationClaimResult> {
    const existing = this.claims.get(logicalOperationKey);
    if (existing) {
      if (existing.contextFingerprint === contextFingerprint) {
        return {
          outcome: 'DUPLICATE' as const,
          existing: {
            logicalOperationKey,
            ...existing,
            claimedAt: new Date(),
          },
        };
      }
      return {
        outcome: 'CONTEXT_CONFLICT' as const,
        existingInvocationId: existing.invocationId,
      };
    }
    this.claims.set(logicalOperationKey, {
      invocationId,
      contextFingerprint,
      state: 'IN_PROGRESS',
    });
    return {
      outcome: 'CLAIMED' as const,
      claim: {
        logicalOperationKey,
        invocationId,
        contextFingerprint,
        state: 'IN_PROGRESS' as GovernedInvocationClaimState,
        claimedAt: new Date(),
      },
    };
  }
}

describe('GovernedRuntimeService (B2c internal runtime entry)', () => {
  let workspaceRoot: string;
  let orgDirName: string;
  let declaration: ProviderDeclaration;
  let providerResolver: { resolve: jest.Mock };
  let auditService: { record: jest.Mock };
  let prisma: {
    governedOperationEnvelope: { create: jest.Mock; update: jest.Mock };
    governedExecutionRecord: { create: jest.Mock };
  };
  let idempotencyStore: InMemoryIdempotencyStore;
  let adapterExecuteSpy: jest.SpyInstance;
  let service: GovernedRuntimeService;

  function buildService(overrides?: {
    humanGateResolver?: unknown;
    credentialBroker?: unknown;
    trustedExecutableResolver?: unknown;
  }): GovernedRuntimeService {
    const registry = new GovernedAdapterRegistryImpl();
    const adapter = new WorkspaceFileToolAdapter();
    adapterExecuteSpy = jest.spyOn(adapter, 'execute');
    registry.register({
      providerType: ProviderType.DETERMINISTIC_TOOL,
      adapter,
      registeredAt: new Date(),
      version: 'b2c.1',
    });

    const invocationService = new GovernedInvocationServiceImpl({
      providerResolver,
      adapterRegistry: registry as GovernedAdapterRegistry,
      credentialBroker: (overrides?.credentialBroker ?? null) as never,
      auditService: auditService as unknown as AuditService,
      executionProfileResolver: new TrustedExecutionProfileResolver(),
      trustedExecutableResolver: (overrides?.trustedExecutableResolver ?? null) as never,
      workingDirectoryResolver: new GovernedWorkingDirectoryResolver(workspaceRoot),
      humanGateResolver: (overrides?.humanGateResolver ?? null) as never,
      homeDirectoryResolver: new GovernedHomeDirectoryResolver(workspaceRoot),
      idempotencyStore: idempotencyStore as unknown as PrismaGovernedIdempotencyStore,
      executionPolicyResolver: new TrustedExecutionPolicyResolver(workspaceRoot),
    });

    return new GovernedRuntimeService(
      invocationService,
      prisma as unknown as PrismaService,
      workspaceRoot,
    );
  }

  function makeTrustedInput(
    overrides?: Partial<TrustedGovernedWorkspaceFileOperation>,
  ): TrustedGovernedWorkspaceFileOperation {
    return {
      trustOrigin: TRUSTED_RUNTIME_ORIGIN,
      organizationId: ORG_A,
      providerId: declaration.id,
      capabilityCode: 'CODE_BUILD',
      requestedAction: 'CREATE_FILE',
      relativePath: `out/${randomUUID()}.txt`,
      content: 'productive governed content',
      ...overrides,
    };
  }

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'vito-b2c-runtime-'));
    orgDirName = governedOrgDirectoryName(ORG_A);
    declaration = makeDeclaration();
    providerResolver = { resolve: jest.fn().mockResolvedValue(declaration) };
    auditService = { record: jest.fn().mockResolvedValue({}) };
    prisma = {
      governedOperationEnvelope: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: randomUUID(),
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      governedExecutionRecord: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    idempotencyStore = new InMemoryIdempotencyStore();
    service = buildService();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('executes the first real internal governed invocation end-to-end', async () => {
    const input = makeTrustedInput();

    const result = await service.executeWorkspaceFileOperation(input);

    expect(result.status).toBe('SUCCEEDED');
    expect(providerResolver.resolve).toHaveBeenCalledWith(declaration.id, ORG_A);

    // envelope created server-side before invocation
    expect(prisma.governedOperationEnvelope.create).toHaveBeenCalledTimes(1);
    const envelopeData = prisma.governedOperationEnvelope.create.mock.calls[0][0].data;
    expect(envelopeData.organizationId).toBe(ORG_A);
    expect(envelopeData.status).toBe('PENDING');

    // exactly ONE productive adapter execution
    expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);

    // file created inside the governed org workspace
    const filePath = join(workspaceRoot, 'orgs', orgDirName, input.relativePath!);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(input.content);

    // normalized result carries no raw file content
    expect(JSON.stringify(result)).not.toContain(input.content);

    // execution record persisted once, mapped via B2a mapper
    expect(prisma.governedExecutionRecord.create).toHaveBeenCalledTimes(1);
    const recordData = prisma.governedExecutionRecord.create.mock.calls[0][0].data;
    expect(recordData.id).toBe(result.invocationId);
    const persistedEnvelope = await prisma.governedOperationEnvelope.create.mock.results[0]
      .value;
    expect(recordData.envelopeId).toBe(persistedEnvelope.id);
    expect(recordData.status).toBe('SUCCEEDED');
    expect(recordData.sideEffectSummary).toEqual({
      filesCreated: [input.relativePath],
      filesModified: [],
      filesDeleted: [],
      commandsExecuted: [],
      artifactsCreated: [`gov://workspace/${input.relativePath}`],
      networkCalls: [],
    });

    // envelope reaches terminal COMPLETED
    expect(prisma.governedOperationEnvelope.update).toHaveBeenCalledTimes(1);
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('COMPLETED');

    // audit evidence written (policy decision + invocation completion)
    expect(auditService.record.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of auditService.record.mock.calls) {
      expect(call[0].organizationId).toBe(ORG_A);
    }
    expect(JSON.stringify(auditService.record.mock.calls)).not.toContain(input.content);

    // claim completed according to frozen semantics
    expect(idempotencyStore.markCompleted).toHaveBeenCalledTimes(1);
    expect(idempotencyStore.markCompleted.mock.calls[0][2]).toBe('COMPLETED');
  });

  it('rejects untrusted operation contexts before any persistence or execution', async () => {
    const untrusted = { ...makeTrustedInput() } as Record<string, unknown>;
    delete untrusted.trustOrigin;

    await expect(
      service.executeWorkspaceFileOperation(untrusted as never),
    ).rejects.toThrow(/GOVERNED_RUNTIME_UNTRUSTED_CONTEXT/);

    expect(prisma.governedOperationEnvelope.create).not.toHaveBeenCalled();
    expect(adapterExecuteSpy).not.toHaveBeenCalled();
  });

  it('fails closed on cross-tenant provider ids without reaching the adapter', async () => {
    providerResolver.resolve.mockResolvedValue(null);

    await expect(service.executeWorkspaceFileOperation(makeTrustedInput())).rejects.toThrow(
      /PROVIDER_UNAVAILABLE/,
    );

    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(prisma.governedExecutionRecord.create).not.toHaveBeenCalled();
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('keeps EO-01.5 ORGANIZATION_MISMATCH defense-in-depth effective', async () => {
    const foreignDeclaration = makeDeclaration({ organizationId: ORG_B });
    providerResolver.resolve.mockResolvedValue(foreignDeclaration);

    await expect(service.executeWorkspaceFileOperation(makeTrustedInput())).rejects.toThrow(
      /ORGANIZATION_MISMATCH/,
    );

    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(prisma.governedExecutionRecord.create).not.toHaveBeenCalled();
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('blocks providers with UNKNOWN credentialRequirement (fail closed)', async () => {
    providerResolver.resolve.mockResolvedValue(
      makeDeclaration({ credentialRequirement: ProviderCredentialRequirement.UNKNOWN }),
    );

    await expect(service.executeWorkspaceFileOperation(makeTrustedInput())).rejects.toThrow(
      /CREDENTIAL_INJECTION_FAILED/,
    );

    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(prisma.governedExecutionRecord.create).not.toHaveBeenCalled();
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('blocks providers with REQUIRED credentials when no broker is wired', async () => {
    providerResolver.resolve.mockResolvedValue(
      makeDeclaration({ credentialRequirement: ProviderCredentialRequirement.REQUIRED }),
    );

    await expect(service.executeWorkspaceFileOperation(makeTrustedInput())).rejects.toThrow(
      /CREDENTIAL_INJECTION_FAILED/,
    );

    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(prisma.governedExecutionRecord.create).not.toHaveBeenCalled();
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('blocks unknown capability/profile mappings (EXECUTION_PROFILE_NOT_GOVERNED)', async () => {
    // Der Provider UNTERSTÜTZT die Capability, aber der trusted
    // Capability->Profil-Map ist sie unbekannt -> Resolver liefert null.
    providerResolver.resolve.mockResolvedValue(
      makeDeclaration({
        capabilityAssignments: [{ capabilityCode: 'CODE_REFACTOR', isEnabled: true }],
      }),
    );

    const result = await service.executeWorkspaceFileOperation(
      makeTrustedInput({ capabilityCode: 'CODE_REFACTOR' }),
    );

    expect(result.status).toBe('POLICY_BLOCKED');
    expect(result.normalizedError?.reason).toBe('EXECUTION_PROFILE_NOT_GOVERNED');
    expect(adapterExecuteSpy).not.toHaveBeenCalled();

    // normalized evidence still persisted; envelope failed
    expect(prisma.governedExecutionRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.governedExecutionRecord.create.mock.calls[0][0].data.status).toBe(
      'POLICY_BLOCKED',
    );
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
    expect(idempotencyStore.claims.size).toBe(0);
  });

  it('blocks disabled provider capability assignments (CAPABILITY_NOT_SUPPORTED)', async () => {
    providerResolver.resolve.mockResolvedValue(
      makeDeclaration({
        capabilityAssignments: [{ capabilityCode: 'CODE_BUILD', isEnabled: false }],
      }),
    );

    await expect(service.executeWorkspaceFileOperation(makeTrustedInput())).rejects.toThrow(
      /CAPABILITY_NOT_SUPPORTED/,
    );

    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(prisma.governedExecutionRecord.create).not.toHaveBeenCalled();
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('never executes the adapter twice for a duplicate consequential invocation', async () => {
    const workflowRunId = randomUUID();
    const workflowStepRunId = randomUUID();
    const shared = {
      workflowRunId,
      workflowStepRunId,
      relativePath: 'out/duplicate-target.txt',
    };

    const first = await service.executeWorkspaceFileOperation(makeTrustedInput(shared));
    expect(first.status).toBe('SUCCEEDED');
    expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);

    const second = await service.executeWorkspaceFileOperation(
      makeTrustedInput({ ...shared, content: 'retry-payload' }),
    );
    expect(second.status).toBe('POLICY_BLOCKED');
    expect(second.normalizedError?.reason).toBe('INVOCATION_DUPLICATE');
    expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);

    // duplicate retry persists its own normalized evidence and fails its envelope
    expect(prisma.governedExecutionRecord.create).toHaveBeenCalledTimes(2);
    expect(prisma.governedExecutionRecord.create.mock.calls[1][0].data.status).toBe(
      'POLICY_BLOCKED',
    );
  });

  it('produces POLICY_BLOCKED with no filesystem mutation for denied targets', async () => {
    const result = await service.executeWorkspaceFileOperation(
      makeTrustedInput({ relativePath: '.env' }),
    );

    expect(result.status).toBe('POLICY_BLOCKED');
    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(existsSync(join(workspaceRoot, 'orgs', orgDirName, '.env'))).toBe(false);

    expect(prisma.governedExecutionRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.governedExecutionRecord.create.mock.calls[0][0].data.status).toBe(
      'POLICY_BLOCKED',
    );
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
    expect(idempotencyStore.claims.size).toBe(0);
  });

  it('cannot execute Human-Gate-required actions with a null HumanGateResolver', async () => {
    const result = await service.executeWorkspaceFileOperation(
      makeTrustedInput({
        requestedAction: 'GIT_PUSH',
        relativePath: undefined,
        content: undefined,
      }),
    );

    // Frozen EO-01.4 v0.1 semantics: allowGitPush=false denies every push
    // before a HumanGate could ever approve it. With a null HumanGateResolver
    // there is additionally NO possible approval path — fail closed either way.
    expect(result.status).toBe('POLICY_BLOCKED');
    expect(result.normalizedError?.providerMetadata?.policyReasonCode).toBe('GIT_PUSH_DENIED');
    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(idempotencyStore.claims.size).toBe(0);
    expect(prisma.governedExecutionRecord.create.mock.calls[0][0].data.status).toBe(
      'POLICY_BLOCKED',
    );
  });

  it('cannot execute RUN_COMMAND with a null TrustedExecutableResolver (pre-boundary throw)', async () => {
    await expect(
      service.executeWorkspaceFileOperation(
        makeTrustedInput({
          requestedAction: 'RUN_COMMAND',
          relativePath: undefined,
          content: undefined,
          command: 'npm test',
        }),
      ),
    ).rejects.toThrow(/EXECUTABLE_NOT_TRUSTED/);

    expect(adapterExecuteSpy).not.toHaveBeenCalled();
    expect(prisma.governedExecutionRecord.create).not.toHaveBeenCalled();
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');
  });

  it('persists normalized failure evidence when the adapter reports FILE_NOT_FOUND', async () => {
    const missingTarget = `out/missing-${randomUUID()}.txt`;

    const result = await service.executeWorkspaceFileOperation(
      makeTrustedInput({
        requestedAction: 'WRITE_FILE',
        relativePath: missingTarget,
      }),
    );

    expect(result.status).toBe('FAILED');
    // Frozen normalization maps failed adapter results to EXECUTION_FAILED
    // (no raw adapter error codes leak into normalized evidence).
    expect(result.normalizedError?.reason).toBe('EXECUTION_FAILED');
    expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);

    expect(prisma.governedExecutionRecord.create).toHaveBeenCalledTimes(1);
    const recordData = prisma.governedExecutionRecord.create.mock.calls[0][0].data;
    expect(recordData.status).toBe('FAILED');
    expect(recordData.normalizedError.reason).toBe('EXECUTION_FAILED');
    expect(prisma.governedOperationEnvelope.update.mock.calls[0][0].data.status).toBe('FAILED');

    // failed consequential execution marks the claim FAILED_UNKNOWN per frozen semantics
    expect(idempotencyStore.markCompleted).toHaveBeenCalledTimes(1);
    expect(idempotencyStore.markCompleted.mock.calls[0][2]).toBe('FAILED_UNKNOWN');
  });

  it('rejects malformed payloads before creating an operation envelope', async () => {
    await expect(
      service.executeWorkspaceFileOperation(
        makeTrustedInput({ content: undefined }),
      ),
    ).rejects.toThrow(/GOVERNED_RUNTIME_MALFORMED_OPERATION/);

    expect(prisma.governedOperationEnvelope.create).not.toHaveBeenCalled();
    expect(adapterExecuteSpy).not.toHaveBeenCalled();
  });
});
