import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConsumeCodeBuildApprovalDto, CreateCodeBuildApprovalDto } from './dto/code-build-approval.dto';
import {
  codeBuildTargetMatchesApprovalScope,
  isCodeBuildExecutionTarget,
  type CodeBuildExecutionTarget,
} from '../governed-runtime/adapters/code-build-execution-target';

@Injectable()
export class CodeBuildApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private hash(value: object): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async requireHuman(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE', deletedAt: null } });
    if (!user || user.isMachineIdentity || (user.role !== UserRole.OWNER && user.role !== UserRole.ADMIN)) {
      throw new ForbiddenException('An active human OWNER or ADMIN identity is required.');
    }
    return user;
  }

  async create(organizationId: string, userId: string, role: UserRole, dto: CreateCodeBuildApprovalDto) {
    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) throw new UnprocessableEntityException('Approval expiry must be in the future.');
    const requestHash = this.hash({ missionId: dto.missionId, repository: dto.repository, branch: dto.branch, expiresAt: expiresAt.toISOString() });
    return this.prisma.$transaction(async (tx) => {
      const approver = await this.requireHuman(tx, organizationId, userId);
      const existing = await tx.codeBuildApproval.findUnique({ where: { organizationId_approvalRequestKey: { organizationId, approvalRequestKey: dto.requestKey } } });
      if (existing) {
        if (existing.approvalRequestHash !== requestHash || existing.approvedByUserId !== userId) throw new ConflictException('Request key was already used with different approval content.');
        return existing;
      }
      const approval = await tx.codeBuildApproval.create({ data: { organizationId, missionId: dto.missionId, repository: dto.repository, branch: dto.branch, expiresAt, approvalRequestKey: dto.requestKey, approvalRequestHash: requestHash, approvedByUserId: userId } });
      await this.audit.record({ organizationId, actorType: 'USER', actorId: userId, action: 'CODE_BUILD_APPROVAL_GRANTED', entityType: 'CodeBuildApproval', entityId: approval.id, metadata: { missionId: dto.missionId, repository: dto.repository, branch: dto.branch, expiresAt: expiresAt.toISOString(), role: approver.role } }, tx);
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

  async workflowDispatchStatus(organizationId: string, missionId: string) {
    const now = new Date();
    const approvals = await this.prisma.codeBuildApproval.findMany({
      where: {
        organizationId,
        missionId,
        repository: 'lavolpeofficial/vito-platform',
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { approvedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        branch: true,
        approvedAt: true,
        expiresAt: true,
        approvedByUserId: true,
      },
    });
    const machineIdentityCount = await this.prisma.user.count({
      where: {
        organizationId,
        status: 'ACTIVE',
        deletedAt: null,
        isMachineIdentity: true,
        machineScope: 'vito-bridge',
      },
    });

    const state =
      approvals.length === 0 ? 'APPROVAL_REQUIRED'
        : approvals.length > 1 ? 'APPROVAL_AMBIGUOUS'
          : machineIdentityCount === 0 ? 'MACHINE_IDENTITY_REQUIRED'
            : machineIdentityCount > 1 ? 'MACHINE_IDENTITY_AMBIGUOUS'
              : 'READY';

    return Object.freeze({
      missionId,
      repository: 'lavolpeofficial/vito-platform' as const,
      state,
      machineIdentityCount,
      approvals: Object.freeze(approvals.map((approval) => Object.freeze({
        id: approval.id,
        branch: approval.branch,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        approvedByUserId: approval.approvedByUserId,
      }))),
      authority: 'READ_ONLY' as const,
    });
  }

  async resolveForWorkflowDispatch(
    organizationId: string,
    missionId: string,
    workflowStepRunId: string,
  ) {
    const now = new Date();
    const approvals = await this.prisma.codeBuildApproval.findMany({
      where: {
        organizationId,
        missionId,
        repository: 'lavolpeofficial/vito-platform',
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { approvedAt: 'desc' },
      take: 2,
    });
    if (approvals.length === 0) {
      throw new ForbiddenException('CODE_BUILD_APPROVAL_REQUIRED');
    }
    if (approvals.length !== 1) {
      throw new ConflictException('CODE_BUILD_APPROVAL_AMBIGUOUS');
    }

    const machineUsers = await this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        deletedAt: null,
        isMachineIdentity: true,
        machineScope: 'vito-bridge',
      },
      orderBy: { id: 'asc' },
      take: 2,
      select: { id: true },
    });
    if (machineUsers.length === 0) {
      throw new ForbiddenException('CODE_BUILD_MACHINE_IDENTITY_REQUIRED');
    }
    if (machineUsers.length !== 1) {
      throw new ConflictException('CODE_BUILD_MACHINE_IDENTITY_AMBIGUOUS');
    }

    const approval = approvals[0];
    return Object.freeze({
      approvalId: approval.id,
      machineUserId: machineUsers[0].id,
      scope: Object.freeze({
        missionId,
        repository: approval.repository,
        branch: approval.branch,
        requestKey: `workflow-step:${workflowStepRunId}`,
      }),
    });
  }

  // Dispatch-only claim: unlike the public idempotent consume endpoint, a replay
  // must never authorize a second provider invocation.
  async consumeForDispatch(
    organizationId: string,
    machineUserId: string,
    id: string,
    dto: ConsumeCodeBuildApprovalDto,
    executionTarget: CodeBuildExecutionTarget,
  ) {
    if (
      !isCodeBuildExecutionTarget(executionTarget) ||
      !codeBuildTargetMatchesApprovalScope(executionTarget, {
      organizationId,
      missionId: dto.missionId,
      repository: dto.repository,
        branch: dto.branch,
      })
    ) {
      throw new ForbiddenException('CODE_BUILD execution target does not match approval scope.');
    }
    const executionTargetHash = this.hash(executionTarget);
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({ where: { id: machineUserId, organizationId, status: 'ACTIVE', deletedAt: null } });
      if (!actor?.isMachineIdentity || actor.machineScope !== 'vito-bridge') throw new ForbiddenException('Active vito-bridge machine identity required.');
      const now = new Date();
      const claimed = await tx.codeBuildApproval.updateMany({
        where: { id, organizationId, missionId: dto.missionId, repository: dto.repository, branch: dto.branch, consumedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: {
          consumedAt: now,
          consumedByUserId: machineUserId,
          consumptionRequestKey: dto.requestKey,
          consumptionRequestHash: this.hash({
            approvalId: id,
            missionId: dto.missionId,
            repository: dto.repository,
            branch: dto.branch,
            executionTargetHash,
          }),
          executionTargetHash,
          executionTarget: executionTarget as unknown as Prisma.InputJsonValue,
        },
      });
      if (claimed.count !== 1) throw new ForbiddenException('No unconsumed CODE_BUILD approval matches this execution.');
      await this.audit.record({
        organizationId,
        actorType: 'USER',
        actorId: machineUserId,
        action: 'CODE_BUILD_APPROVAL_CONSUMED',
        entityType: 'CodeBuildApproval',
        entityId: id,
        metadata: {
          missionId: dto.missionId,
          repository: dto.repository,
          branch: dto.branch,
          requestKey: dto.requestKey,
          executionTargetHash,
          executionTarget: {
            version: executionTarget.version,
            workflowRunId: executionTarget.workflowRunId,
            workflowStepRunId: executionTarget.workflowStepRunId,
            providerId: executionTarget.providerId,
            providerCode: executionTarget.providerCode,
            executionTier: executionTarget.executionTier,
            commandAlias: executionTarget.commandAlias,
            baseRef: executionTarget.baseRef,
          },
        },
      }, tx);
      return tx.codeBuildApproval.findUniqueOrThrow({ where: { id } });
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
