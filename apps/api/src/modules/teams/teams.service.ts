import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateTeamDto) {
    await this.assertDepartment(organizationId, dto.departmentId, dto.workforceInstanceId);
    await this.assertManager(organizationId, dto.managerEmployeeId, dto.workforceInstanceId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: { organizationId, ...dto },
          include: { department: true, manager: true, workforceInstance: true },
        });
        await this.auditService.record({
          organizationId,
          actorType: 'SYSTEM',
          action: 'TEAM_CREATED',
          entityType: 'Team',
          entityId: team.id,
          metadata: { code: team.code, departmentId: team.departmentId },
        }, tx);
        return team;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ein Team mit diesem code existiert bereits in diesem Department.');
      }
      throw error;
    }
  }

  findAll(organizationId: string, departmentId?: string) {
    return this.prisma.team.findMany({
      where: { organizationId, ...(departmentId ? { departmentId } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { department: true, manager: true, workforceInstance: true },
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const team = await this.prisma.team.findFirst({
      where: { id, organizationId },
      include: { department: true, manager: true, workforceInstance: true },
    });
    if (!team) throw new NotFoundException('Team nicht gefunden.');
    return team;
  }

  async update(organizationId: string, id: string, dto: UpdateTeamDto) {
    const existing = await this.findByIdOrFail(organizationId, id);
    const departmentId = dto.departmentId ?? existing.departmentId;
    const department = await this.prisma.department.findFirst({ where: { id: departmentId, organizationId } });
    if (!department) throw new NotFoundException('Department nicht gefunden.');
    await this.assertManager(organizationId, dto.managerEmployeeId ?? undefined, department.workforceInstanceId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.team.update({
          where: { id },
          data: { ...dto, workforceInstanceId: department.workforceInstanceId },
          include: { department: true, manager: true, workforceInstance: true },
        });
        await this.auditService.record({
          organizationId,
          actorType: 'SYSTEM',
          action: 'TEAM_UPDATED',
          entityType: 'Team',
          entityId: updated.id,
          metadata: { changes: dto },
        }, tx);
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Ein Team mit diesem code existiert bereits in diesem Department.');
      }
      throw error;
    }
  }

  private async assertDepartment(organizationId: string, departmentId: string, workforceInstanceId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, organizationId, workforceInstanceId },
      select: { id: true },
    });
    if (!department) throw new NotFoundException('Department gehört nicht zu dieser Organization und Workforce.');
  }

  private async assertManager(organizationId: string, managerEmployeeId: string | undefined, workforceInstanceId: string) {
    if (!managerEmployeeId) return;
    const manager = await this.prisma.digitalEmployee.findFirst({
      where: { id: managerEmployeeId, organizationId, workforceInstanceId },
      select: { id: true },
    });
    if (!manager) throw new NotFoundException('Team-Manager gehört nicht zu dieser Organization und Workforce.');
  }
}
