import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PositionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

const positionInclude = {
  workforceInstance: true,
  department: true,
  team: true,
  organizationRole: true,
  managerPosition: true,
  occupant: true,
  directReports: true,
} satisfies Prisma.PositionInclude;

@Injectable()
export class PositionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreatePositionDto) {
    const context = await this.validateContext(organizationId, dto);
    const status = dto.occupantEmployeeId ? PositionStatus.OCCUPIED : dto.status ?? PositionStatus.DRAFT;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const position = await tx.position.create({
          data: {
            organizationId,
            ...dto,
            departmentId: context.departmentId,
            teamId: context.teamId,
            status,
          },
          include: positionInclude,
        });
        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'POSITION_CREATED',
            entityType: 'Position',
            entityId: position.id,
            metadata: { code: position.code, occupantEmployeeId: position.occupantEmployeeId },
          },
          tx,
        );
        return position;
      });
    } catch (error) {
      this.handleConstraintError(error);
    }
  }

  findAll(organizationId: string, workforceInstanceId?: string) {
    return this.prisma.position.findMany({
      where: { organizationId, ...(workforceInstanceId ? { workforceInstanceId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: positionInclude,
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const position = await this.prisma.position.findFirst({
      where: { id, organizationId },
      include: positionInclude,
    });
    if (!position) throw new NotFoundException('Position nicht gefunden.');
    return position;
  }

  async update(organizationId: string, id: string, dto: UpdatePositionDto) {
    const existing = await this.findByIdOrFail(organizationId, id);
    const merged = {
      workforceInstanceId: dto.workforceInstanceId ?? existing.workforceInstanceId,
      departmentId: dto.departmentId === undefined ? existing.departmentId : dto.departmentId,
      teamId: dto.teamId === undefined ? existing.teamId : dto.teamId,
      organizationRoleId: dto.organizationRoleId ?? existing.organizationRoleId,
      managerPositionId: dto.managerPositionId === undefined ? existing.managerPositionId : dto.managerPositionId,
      occupantEmployeeId: dto.occupantEmployeeId === undefined ? existing.occupantEmployeeId : dto.occupantEmployeeId,
    };

    if (merged.managerPositionId === id) {
      throw new ConflictException('Eine Position kann nicht ihre eigene Vorgesetztenposition sein.');
    }
    if (merged.managerPositionId) await this.assertNoHierarchyCycle(organizationId, id, merged.managerPositionId);

    const context = await this.validateContext(organizationId, merged);
    const occupantChanged = dto.occupantEmployeeId !== undefined;
    const normalizedStatus = occupantChanged
      ? dto.occupantEmployeeId
        ? PositionStatus.OCCUPIED
        : PositionStatus.VACANT
      : dto.status;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.position.update({
          where: { id },
          data: {
            ...dto,
            departmentId: context.departmentId,
            teamId: context.teamId,
            ...(normalizedStatus ? { status: normalizedStatus } : {}),
          },
          include: positionInclude,
        });
        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: occupantChanged
              ? dto.occupantEmployeeId
                ? 'POSITION_ASSIGNED'
                : 'POSITION_VACATED'
              : 'POSITION_UPDATED',
            entityType: 'Position',
            entityId: updated.id,
            metadata: { changes: dto },
          },
          tx,
        );
        return updated;
      });
    } catch (error) {
      this.handleConstraintError(error);
    }
  }

  private async validateContext(
    organizationId: string,
    input: {
      workforceInstanceId: string;
      departmentId?: string | null;
      teamId?: string | null;
      organizationRoleId: string;
      managerPositionId?: string | null;
      occupantEmployeeId?: string | null;
    },
  ) {
    const workforce = await this.prisma.workforceInstance.findFirst({
      where: { id: input.workforceInstanceId, organizationId },
      select: { id: true },
    });
    if (!workforce) throw new NotFoundException('Workforce gehört nicht zu dieser Organization.');

    const role = await this.prisma.organizationRole.findFirst({
      where: { id: input.organizationRoleId, organizationId },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Organization Role gehört nicht zu dieser Organization.');

    let departmentId = input.departmentId ?? null;
    const teamId = input.teamId ?? null;

    if (teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: teamId, organizationId, workforceInstanceId: input.workforceInstanceId },
        select: { id: true, departmentId: true },
      });
      if (!team) throw new NotFoundException('Team gehört nicht zu dieser Organization und Workforce.');
      if (departmentId && departmentId !== team.departmentId) {
        throw new ConflictException('Team und Department sind inkonsistent.');
      }
      departmentId = team.departmentId;
    }

    if (departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: departmentId, organizationId, workforceInstanceId: input.workforceInstanceId },
        select: { id: true },
      });
      if (!department) throw new NotFoundException('Department gehört nicht zu dieser Organization und Workforce.');
    }

    if (input.managerPositionId) {
      const manager = await this.prisma.position.findFirst({
        where: { id: input.managerPositionId, organizationId, workforceInstanceId: input.workforceInstanceId },
        select: { id: true },
      });
      if (!manager) throw new NotFoundException('Vorgesetztenposition gehört nicht zu dieser Organization und Workforce.');
    }

    if (input.occupantEmployeeId) {
      const occupant = await this.prisma.digitalEmployee.findFirst({
        where: { id: input.occupantEmployeeId, organizationId, workforceInstanceId: input.workforceInstanceId },
        select: { id: true },
      });
      if (!occupant) throw new NotFoundException('Occupant gehört nicht zu dieser Organization und Workforce.');
    }

    return { departmentId, teamId };
  }

  private async assertNoHierarchyCycle(organizationId: string, positionId: string, managerPositionId: string) {
    let currentId: string | null = managerPositionId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === positionId) throw new ConflictException('Die Positionshierarchie würde einen Zyklus erzeugen.');
      if (visited.has(currentId)) throw new ConflictException('Bestehender Zyklus in der Positionshierarchie erkannt.');
      visited.add(currentId);

      const current: { managerPositionId: string | null } | null = await this.prisma.position.findFirst({
        where: { id: currentId, organizationId },
        select: { managerPositionId: true },
      });
      currentId = current?.managerPositionId ?? null;
    }
  }

  private handleConstraintError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('Positionscode oder Occupant ist bereits einer anderen Position zugeordnet.');
    }
    throw error;
  }
}
