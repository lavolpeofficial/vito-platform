import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GovernedInvocationServiceImpl } from '../governed-invocation/governed-invocation.service';
import { GovernedAdapterRegistryImpl } from '../governed-invocation/governed-adapter-registry';
import { ProviderType } from '@vito/contracts';
import { PrismaGovernedIdempotencyStore } from './persistence/prisma-governed-idempotency.store';
import { PrismaProviderDeclarationResolver } from './resolvers/prisma-provider-declaration.resolver';
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
} from './governed-runtime.service';

/**
 * B2c REAL-PostgreSQL proof: first productive governed invocation incl.
 * envelope lifecycle, execution record persistence, durable idempotency
 * claim and audit evidence. Skipped unless GOVERNED_RUNTIME_TEST_DATABASE_URL
 * points at an isolated PostgreSQL database (CI has no database service).
 */
const DATABASE_URL = process.env.GOVERNED_RUNTIME_TEST_DATABASE_URL;
const describePg = DATABASE_URL ? describe : describe.skip;

describePg('GovernedRuntimeService on real PostgreSQL (B2c proof)', () => {
  let prismaService: PrismaService;
  let workspaceRoot: string;
  let orgDirName: string;
  let organizationId: string;
  let providerId: string;
  let adapterExecuteSpy: jest.SpyInstance;
  let service: GovernedRuntimeService;

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prismaService = new PrismaService();
    await prismaService.onModuleInit();

    workspaceRoot = mkdtempSync(join(tmpdir(), 'vito-b2c-pg-'));
    organizationId = randomUUID();

    await prismaService.organization.create({
      data: { id: organizationId, name: 'B2c PG Proof', slug: `b2c-pg-${randomUUID()}` },
    });

    providerId = randomUUID();
    await prismaService.agentProvider.create({
      data: {
        id: providerId,
        organizationId,
        providerCode: 'workspace-file-tool',
        displayName: 'Workspace File Tool (PG proof)',
        providerType: 'DETERMINISTIC_TOOL',
        status: 'ACTIVE',
        healthStatus: 'HEALTHY',
        quotaStatus: 'AVAILABLE',
        credentialRequirement: 'NOT_REQUIRED',
        capabilities: {
          create: { organizationId, capabilityCode: 'CODE_BUILD', isEnabled: true },
        },
      },
    });
    orgDirName = governedOrgDirectoryName(organizationId);

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
      providerResolver: new PrismaProviderDeclarationResolver(prismaService),
      adapterRegistry: registry,
      credentialBroker: null,
      auditService: new AuditService(prismaService),
      executionProfileResolver: new TrustedExecutionProfileResolver(),
      trustedExecutableResolver: null,
      workingDirectoryResolver: new GovernedWorkingDirectoryResolver(workspaceRoot),
      humanGateResolver: null,
      homeDirectoryResolver: new GovernedHomeDirectoryResolver(workspaceRoot),
      idempotencyStore: new PrismaGovernedIdempotencyStore(prismaService),
      executionPolicyResolver: new TrustedExecutionPolicyResolver(workspaceRoot),
    });

    service = new GovernedRuntimeService(invocationService, prismaService, workspaceRoot);
  });

  afterAll(async () => {
    if (!DATABASE_URL) return;

    await prismaService.governedExecutionRecord.deleteMany({ where: { organizationId } });
    await prismaService.governedInvocationClaim.deleteMany({
      where: { logicalOperationKey: { contains: `${organizationId.length}:${organizationId}` } },
    });
    await prismaService.governedOperationEnvelope.deleteMany({ where: { organizationId } });
    await prismaService.agentProvider.deleteMany({ where: { organizationId } });
    await prismaService.auditEvent.deleteMany({ where: { organizationId } });
    await prismaService.organization.deleteMany({ where: { id: organizationId } });
    await prismaService.onModuleDestroy();
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('executes the first real governed invocation end-to-end and blocks duplicates durably', async () => {
    const workflowRunId = randomUUID();
    const workflowStepRunId = randomUUID();
    const relativePath = `out/pg-proof-${randomUUID()}.txt`;
    const content = 'first real productive governed invocation';

    const result = await service.executeWorkspaceFileOperation({
      trustOrigin: TRUSTED_RUNTIME_ORIGIN,
      organizationId,
      providerId,
      capabilityCode: 'CODE_BUILD',
      requestedAction: 'CREATE_FILE',
      relativePath,
      content,
      workflowRunId,
      workflowStepRunId,
    });

    // 1. normalized success + exactly one productive adapter execution
    expect(result.status).toBe('SUCCEEDED');
    expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);

    // 2. file exists inside the governed org workspace
    const filePath = join(workspaceRoot, 'orgs', orgDirName, relativePath);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf8')).toBe(content);
    expect(JSON.stringify(result)).not.toContain(content);

    // 3. envelope lifecycle PENDING -> COMPLETED persisted
    const envelopes = await prismaService.governedOperationEnvelope.findMany({
      where: { organizationId },
    });
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].status).toBe('COMPLETED');
    expect(envelopes[0].purposeCode).toBe('INTERNAL_WORKSPACE_FILE_TOOL');

    // 4. execution record persisted and linked to the envelope
    const records = await prismaService.governedExecutionRecord.findMany({
      where: { organizationId },
    });
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(result.invocationId);
    expect(records[0].envelopeId).toBe(envelopes[0].id);
    expect(records[0].status).toBe('SUCCEEDED');
    expect(records[0].sideEffectSummary).toEqual({
      filesCreated: [relativePath],
      filesModified: [],
      filesDeleted: [],
      commandsExecuted: [],
      artifactsCreated: [`gov://workspace/${relativePath}`],
      networkCalls: [],
    });

    // 5. durable claim reached terminal COMPLETED state
    const claims = await prismaService.governedInvocationClaim.findMany({});
    const relatedClaim = claims.find((c) =>
      c.logicalOperationKey.includes(`${organizationId.length}:${organizationId}`),
    );
    expect(relatedClaim).toBeDefined();
    expect(relatedClaim!.state).toBe('COMPLETED');

    // 6. audit evidence written for the tenant
    const audits = await prismaService.auditEvent.findMany({ where: { organizationId } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain(content);

    // 7. duplicate retry of the same logical operation is blocked durably
    const duplicate = await service.executeWorkspaceFileOperation({
      trustOrigin: TRUSTED_RUNTIME_ORIGIN,
      organizationId,
      providerId,
      capabilityCode: 'CODE_BUILD',
      requestedAction: 'CREATE_FILE',
      relativePath,
      content: 'retry-payload-must-not-execute',
      workflowRunId,
      workflowStepRunId,
    });

    expect(duplicate.status).toBe('POLICY_BLOCKED');
    expect(duplicate.normalizedError?.reason).toBe('INVOCATION_DUPLICATE');
    expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);

    const duplicateRecords = await prismaService.governedExecutionRecord.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    expect(duplicateRecords).toHaveLength(2);
    expect(duplicateRecords[1].status).toBe('POLICY_BLOCKED');

    const failedEnvelope = await prismaService.governedOperationEnvelope.findFirst({
      where: { organizationId, status: 'FAILED' },
    });
    expect(failedEnvelope).not.toBeNull();

    // cross-tenant provider id never resolves to a foreign declaration
    const foreignOrg = randomUUID();
    await prismaService.organization.create({
      data: { id: foreignOrg, name: 'Foreign Org', slug: `b2c-foreign-${randomUUID()}` },
    });
    try {
      await expect(
        service.executeWorkspaceFileOperation({
          trustOrigin: TRUSTED_RUNTIME_ORIGIN,
          organizationId: foreignOrg,
          providerId,
          capabilityCode: 'CODE_BUILD',
          requestedAction: 'CREATE_FILE',
          relativePath: `out/foreign-${randomUUID()}.txt`,
          content: 'must not execute',
        }),
      ).rejects.toThrow(/PROVIDER_UNAVAILABLE|ORGANIZATION_MISMATCH/);
      expect(adapterExecuteSpy).toHaveBeenCalledTimes(1);
    } finally {
      // The failed cross-tenant attempt legitimately stamped its own FAILED
      // envelope for the foreign tenant before provider resolution rejected.
      await prismaService.governedExecutionRecord.deleteMany({ where: { organizationId: foreignOrg } });
      await prismaService.governedOperationEnvelope.deleteMany({ where: { organizationId: foreignOrg } });
      await prismaService.organization.deleteMany({ where: { id: foreignOrg } });
    }
  });
});
