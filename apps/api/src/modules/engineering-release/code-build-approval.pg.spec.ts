import { ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CodeBuildApprovalService } from './code-build-approval.service';

const DATABASE_URL = process.env.CODE_BUILD_TEST_DATABASE_URL;
const describePg = DATABASE_URL ? describe : describe.skip;

describePg('CODE_BUILD approval PostgreSQL security gate', () => {
  let prisma: PrismaService;
  let service: CodeBuildApprovalService;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    service = new CodeBuildApprovalService(prisma, new AuditService(prisma));
  });

  afterAll(async () => {
    if (!DATABASE_URL) return;
    for (const organizationId of organizationIds) {
      await prisma.codeBuildApproval.deleteMany({ where: { organizationId } });
      await prisma.auditEvent.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.onModuleDestroy();
  });

  async function tenant() {
    const organizationId = randomUUID();
    organizationIds.push(organizationId);
    await prisma.organization.create({ data: { id: organizationId, name: 'CODE_BUILD PG', slug: `code-build-${randomUUID()}` } });
    const human = await prisma.user.create({ data: { organizationId, email: `${randomUUID()}@example.com`, firstName: 'Human', lastName: 'Owner', role: 'OWNER' } });
    const machine = await prisma.user.create({ data: { organizationId, email: `${randomUUID()}@example.com`, firstName: 'Bridge', lastName: 'Machine', role: 'MEMBER', isMachineIdentity: true, machineScope: 'vito-bridge' } });
    return { organizationId, human, machine };
  }

  const approval = (requestKey = randomUUID()) => ({ missionId: `mission-${randomUUID()}`, repository: 'lavolpeofficial/vito-platform', branch: `feat/test-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), requestKey });
  const consumption = (source: ReturnType<typeof approval>, requestKey = randomUUID()) => ({ missionId: source.missionId, repository: source.repository, branch: source.branch, requestKey });

  it('requires a real human and makes approval requests idempotent while rejecting changed replay content', async () => {
    const t = await tenant();
    const dto = approval();
    await expect(service.create(t.organizationId, t.machine.id, 'OWNER', dto)).rejects.toBeInstanceOf(ForbiddenException);
    const first = await service.create(t.organizationId, t.human.id, 'OWNER', dto);
    const replay = await service.create(t.organizationId, t.human.id, 'OWNER', dto);
    expect(replay.id).toBe(first.id);
    await expect(service.create(t.organizationId, t.human.id, 'OWNER', { ...dto, missionId: 'changed' })).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.auditEvent.count({ where: { organizationId: t.organizationId, action: 'CODE_BUILD_APPROVAL_GRANTED' } })).toBe(1);
  });

  it('binds consumption to tenant, mission, repository and branch and fails closed on mismatch', async () => {
    const owner = await tenant();
    const other = await tenant();
    const dto = approval();
    const stored = await service.create(owner.organizationId, owner.human.id, 'OWNER', dto);
    await expect(service.consume(other.organizationId, other.machine.id, stored.id, consumption(dto))).rejects.toThrow();
    for (const change of [{ missionId: 'wrong' }, { branch: 'feat/wrong' }, { repository: 'lavolpeofficial/other' }]) {
      await expect(service.consume(owner.organizationId, owner.machine.id, stored.id, { ...consumption(dto), ...change })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect((await prisma.codeBuildApproval.findUniqueOrThrow({ where: { id: stored.id } })).consumedAt).toBeNull();
  });

  it('rejects revoked and expired approvals', async () => {
    const t = await tenant();
    const revokedDto = approval();
    const revoked = await service.create(t.organizationId, t.human.id, 'OWNER', revokedDto);
    await service.revoke(t.organizationId, t.human.id, revoked.id);
    await expect(service.consume(t.organizationId, t.machine.id, revoked.id, consumption(revokedDto))).rejects.toBeInstanceOf(ForbiddenException);
    const expiredDto = approval();
    const expired = await service.create(t.organizationId, t.human.id, 'OWNER', expiredDto);
    await prisma.codeBuildApproval.update({ where: { id: expired.id }, data: { approvedAt: new Date(Date.now() - 2_000), expiresAt: new Date(Date.now() - 1_000) } });
    await expect(service.consume(t.organizationId, t.machine.id, expired.id, consumption(expiredDto))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('consumes once transactionally, supports exact replay, and records exactly one audit event', async () => {
    const t = await tenant();
    const dto = approval();
    const stored = await service.create(t.organizationId, t.human.id, 'OWNER', dto);
    const consumeDto = consumption(dto);
    const first = await service.consume(t.organizationId, t.machine.id, stored.id, consumeDto);
    const replay = await service.consume(t.organizationId, t.machine.id, stored.id, consumeDto);
    expect(replay.consumedAt).toEqual(first.consumedAt);
    await expect(service.consume(t.organizationId, t.machine.id, stored.id, { ...consumeDto, requestKey: randomUUID() })).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.auditEvent.count({ where: { organizationId: t.organizationId, action: 'CODE_BUILD_APPROVAL_CONSUMED', entityId: stored.id } })).toBe(1);
  });

  it('allows exactly one winner under concurrent consumption', async () => {
    const t = await tenant();
    const dto = approval();
    const stored = await service.create(t.organizationId, t.human.id, 'OWNER', dto);
    const results = await Promise.allSettled([
      service.consume(t.organizationId, t.machine.id, stored.id, consumption(dto)),
      service.consume(t.organizationId, t.machine.id, stored.id, consumption(dto)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { organizationId: t.organizationId, action: 'CODE_BUILD_APPROVAL_CONSUMED', entityId: stored.id } })).toBe(1);
  });
});
