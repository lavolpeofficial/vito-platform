import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConsumeCodeBuildApprovalDto, CreateCodeBuildApprovalDto } from './dto/code-build-approval.dto';

@Injectable()
export class CodeBuildApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private hash(value: object): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async requireHuman(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE', deletedAt: null } });
    if (!user || user.isMachineIdentity) throw new ForbiddenException('A currently authenticated human identity is required.');
    return user;
  }

  async create(organizationId: string, userId: string, role: UserRole, dto: CreateCodeBuildApprovalDto) {
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) throw new UnprocessableEntityException('Approval expiry must be in the future.');
    const requestHash = this.hash({ missionId: dto.missionId, repository: dto.repository, branch: dto.branch, expiresAt: expiresAt.toISOString() });
    return this.prisma.$transaction(async (tx) => {
      await this.requireHuman(tx, organizationId, userId);
      const existing = await tx.codeBuildApproval.findUnique({ where: { organizationId_approvalRequestKey: { organizationId, approvalRequestKey: dto.requestKey } } });
      if (existing) {
        if (existing.approvalRequestHash !== requestHash || existing.approvedByUserId !== userId) throw new ConflictException('Request key was already used with different approval content.');
        return existing;
      }
      const approval = await tx.codeBuildApproval.create({ data: { organizationId, missionId: dto.missionId, repository: dto.repository, branch: dto.branch, expiresAt, approvalRequestKey: dto.requestKey, approvalRequestHash: requestHash, approvedByUserId: userId } });
      await this.audit.record({ organizationId, actorType: 'USER', actorId: userId, action: 'CODE_BUILD_APPROVAL_GRANTED', entityType: 'CodeBuildApproval', entityId: approval.id, metadata: { missionId: dto.missionId, repository: dto.repository, branch: dto.branch, expiresAt: expiresAt.toISOString(), role } }, tx);
      return approval;
    });
  }

  async revoke(organizationId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireHuman(tx, organizationId, userId);
      const approval = await tx.codeBuildApproval.findFirst({ where: { id, organizationId } });
      if (!approval) throw new NotFoundException('CODE_BUILD approval not found.');
      if (approval.revokedAt) return approval;
      if (approval.consumedAt) throw new ConflictException('A consumed approval cannot be revoked.');
      const revoked = await tx.codeBuildApproval.update({ where: { id }, data: { revokedAt: new Date(), revokedByUserId: userId } });
      await this.audit.record({ organizationId, actorType: 'USER', actorId: userId, action: 'CODE_BUILD_APPROVAL_REVOKED', entityType: 'CodeBuildApproval', entityId: id }, tx);
      return revoked;
    });
  }

  async consume(organizationId: string, machineUserId: string, id: string, dto: ConsumeCodeBuildApprovalDto) {
    const requestHash = this.hash({ approvalId: id, missionId: dto.missionId, repository: dto.repository, branch: dto.branch });
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: machineUserId, organizationId, status: 'ACTIVE', deletedAt: null } });
      if (!actor?.isMachineIdentity) throw new ForbiddenException('A scoped machine identity is required.');
      const approval = await tx.codeBuildApproval.findFirst({ where: { id, organizationId } });
      if (!approval) throw new NotFoundException('CODE_BUILD approval not found.');
      if (approval.consumedAt) {
        if (approval.consumptionRequestKey === dto.requestKey && approval.consumptionRequestHash === requestHash && approval.consumedByUserId === machineUserId) return approval;
        throw new ConflictException('Approval was already consumed.');
      }
      if (approval.revokedAt || approval.expiresAt.getTime() <= Date.now() || approval.missionId !== dto.missionId || approval.repository !== dto.repository || approval.branch !== dto.branch) throw new ForbiddenException('No valid CODE_BUILD approval exists for the requested execution scope.');
      const consumedAt = new Date();
      const claimed = await tx.codeBuildApproval.updateMany({ where: { id, organizationId, consumedAt: null, revokedAt: null, expiresAt: { gt: consumedAt } }, data: { consumedAt, consumedByUserId: machineUserId, consumptionRequestKey: dto.requestKey, consumptionRequestHash: requestHash } });
      if (claimed.count !== 1) throw new ConflictException('Approval is no longer available for consumption.');
      await this.audit.record({ organizationId, actorType: 'USER', actorId: machineUserId, action: 'CODE_BUILD_APPROVAL_CONSUMED', entityType: 'CodeBuildApproval', entityId: id, metadata: { missionId: dto.missionId, repository: dto.repository, branch: dto.branch, requestKey: dto.requestKey } }, tx);
      return tx.codeBuildApproval.findUniqueOrThrow({ where: { id } });
    });
  }
}
