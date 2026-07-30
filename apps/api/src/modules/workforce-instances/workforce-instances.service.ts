import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWorkforceInstanceDto } from './dto/create-workforce-instance.dto';
import { UpdateWorkforceInstanceDto } from './dto/update-workforce-instance.dto';

@Injectable()
export class WorkforceInstancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateWorkforceInstanceDto) {
    await this.assertValidOrchestrator(organizationId, dto.orchestratorEmployeeId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.workforceInstance.updateMany({
            where: { organizationId, isDefault: true },
            data: { isDefault: false },
          });
        }

        const workforce = await tx.workforceInstance.create({
          data: {
            organizationId,
            code: dto.code,
            name: dto.name,
            description: dto.description,
            status: dto.status,
            isDefault: dto.isDefault,
            orchestratorEmployeeId: dto.orchestratorEmployeeId,
          },
          include: { orchestrator: true, members: true },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'WORKFORCE_INSTANCE_CREATED',
            entityType: 'WorkforceInstance',
            entityId: workforce.id,
            metadata: { code: workforce.code, orchestratorEmployeeId: workforce.orchestratorEmployeeId },
          },
          tx,
        );

        return workforce;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Eine WorkforceInstance mit diesem code existiert bereits in dieser Organization.');
      }
      throw err;
    }
  }

  findAll(organizationId: string) {
    return this.prisma.workforceInstance.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { orchestrator: true, members: true },
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const workforce = await this.prisma.workforceInstance.findFirst({
      where: { id, organizationId },
      include: { orchestrator: true, members: true },
    });
    if (!workforce) {
      throw new NotFoundException('WorkforceInstance nicht gefunden.');
    }
    return workforce;
  }

  async update(organizationId: string, id: string, dto: UpdateWorkforceInstanceDto) {
    await this.findByIdOrFail(organizationId, id);
    await this.assertValidOrchestrator(organizationId, dto.orchestratorEmployeeId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.workforceInstance.updateMany({
            where: { organizationId, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }

        const updated = await tx.workforceInstance.update({
          where: { id },
          data: dto,
          include: { orchestrator: true, members: true },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'WORKFORCE_INSTANCE_UPDATED',
            entityType: 'WorkforceInstance',
            entityId: updated.id,
            metadata: { changes: dto },
          },
          tx,
        );

        return updated;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Eine WorkforceInstance mit diesem code existiert bereits in dieser Organization.');
      }
      throw err;
    }
  }

  private async assertValidOrchestrator(organizationId: string, orchestratorEmployeeId?: string): Promise<void> {
    if (!orchestratorEmployeeId) return;

    const orchestrator = await this.prisma.digitalEmployee.findFirst({
      where: {
        id: orchestratorEmployeeId,
        organizationId,
        employeeType: EmployeeType.ORCHESTRATOR,
      },
      select: { id: true },
    });

    if (!orchestrator) {
      throw new NotFoundException('Der Orchestrator existiert nicht in dieser Organization oder ist kein ORCHESTRATOR.');
    }
  }
}
