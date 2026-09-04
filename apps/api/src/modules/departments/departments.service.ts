import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateDepartmentDto) {
    await this.assertWorkforce(organizationId, dto.workforceInstanceId);
    await this.assertParent(organizationId, dto.workforceInstanceId, dto.parentDepartmentId);
    await this.assertManager(organizationId, dto.workforceInstanceId, dto.managerEmployeeId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const department = await tx.department.create({
          data: {
            organizationId,
            workforceInstanceId: dto.workforceInstanceId,
            parentDepartmentId: dto.parentDepartmentId,
            managerEmployeeId: dto.managerEmployeeId,
            code: dto.code,
            name: dto.name,
            description: dto.description,
            status: dto.status,
          },
          include: this.includeGraph,
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'DEPARTMENT_CREATED',
            entityType: 'Department',
            entityId: department.id,
            metadata: {
              code: department.code,
              workforceInstanceId: department.workforceInstanceId,
              parentDepartmentId: department.parentDepartmentId,
              managerEmployeeId: department.managerEmployeeId,
            },
          },
          tx,
        );

        return department;
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  findAll(organizationId: string, workforceInstanceId?: string) {
    return this.prisma.department.findMany({
      where: { organizationId, workforceInstanceId },
      orderBy: [{ createdAt: 'asc' }],
      include: this.includeGraph,
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, organizationId },
      include: this.includeGraph,
    });

    if (!department) {
      throw new NotFoundException('Department nicht gefunden.');
    }

    return department;
  }

  async update(organizationId: string, id: string, dto: UpdateDepartmentDto) {
    const current = await this.findByIdOrFail(organizationId, id);

    if (dto.parentDepartmentId === id) {
      throw new UnprocessableEntityException('Ein Department kann nicht sein eigenes Parent-Department sein.');
    }

    if (dto.parentDepartmentId) {
      await this.assertParent(organizationId, current.workforceInstanceId, dto.parentDepartmentId);
      await this.assertNoCycle(organizationId, id, dto.parentDepartmentId);
    }

    if (dto.managerEmployeeId) {
      await this.assertManager(organizationId, current.workforceInstanceId, dto.managerEmployeeId);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.department.update({
          where: { id },
          data: dto,
          include: this.includeGraph,
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'DEPARTMENT_UPDATED',
            entityType: 'Department',
            entityId: updated.id,
            metadata: { changes: dto },
          },
          tx,
        );

        return updated;
      });
    } catch (error) {
      this.rethrowUniqueConflict(error);
    }
  }

  private readonly includeGraph = {
    workforceInstance: true,
    parentDepartment: true,
    childDepartments: true,
    manager: true,
  } as const;

  private async assertWorkforce(organizationId: string, workforceInstanceId: string): Promise<void> {
    const workforce = await this.prisma.workforceInstance.findFirst({
      where: { id: workforceInstanceId, organizationId },
      select: { id: true },
    });

    if (!workforce) {
      throw new NotFoundException('WorkforceInstance nicht gefunden oder gehört nicht zu dieser Organization.');
    }
  }

  private async assertParent(
    organizationId: string,
    workforceInstanceId: string,
    parentDepartmentId?: string,
  ): Promise<void> {
    if (!parentDepartmentId) return;

    const parent = await this.prisma.department.findFirst({
      where: { id: parentDepartmentId, organizationId, workforceInstanceId },
      select: { id: true },
    });

    if (!parent) {
      throw new NotFoundException('Parent-Department existiert nicht in derselben Workforce.');
    }
  }

  private async assertManager(
    organizationId: string,
    workforceInstanceId: string,
    managerEmployeeId?: string,
  ): Promise<void> {
    if (!managerEmployeeId) return;

    const manager = await this.prisma.digitalEmployee.findFirst({
      where: { id: managerEmployeeId, organizationId, workforceInstanceId },
      select: { id: true },
    });

    if (!manager) {
      throw new NotFoundException('Department-Manager existiert nicht in derselben Workforce.');
    }
  }

  private async assertNoCycle(organizationId: string, departmentId: string, candidateParentId: string): Promise<void> {
    let cursor: string | null = candidateParentId;
    const visited = new Set<string>();

    while (cursor) {
      if (cursor === departmentId) {
        throw new UnprocessableEntityException('Die Department-Hierarchie würde einen Zyklus erzeugen.');
      }
      if (visited.has(cursor)) {
        throw new UnprocessableEntityException('Die bestehende Department-Hierarchie enthält einen Zyklus.');
      }
      visited.add(cursor);

      const parent: { parentDepartmentId: string | null } | null = await this.prisma.department.findFirst({
        where: { id: cursor, organizationId },
        select: { parentDepartmentId: true },
      });
      cursor = parent?.parentDepartmentId ?? null;
    }
  }

  private rethrowUniqueConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('Ein Department mit diesem code existiert bereits in dieser Workforce.');
    }
    throw error;
  }
}
