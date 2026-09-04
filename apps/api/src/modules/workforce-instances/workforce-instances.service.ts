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
    const orchestrator = await this.findValidOrchestrator(organizationId, dto.orchestratorEmployeeId);

    if (orchestrator?.workforceInstanceId) {
      throw new ConflictException('Der Orchestrator gehört bereits zu einer anderen WorkforceInstance.');
    }

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
        });

        if (dto.orchestratorEmployeeId) {
          await tx.digitalEmployee.update({
            where: { id: dto.orchestratorEmployeeId },
            data: { workforceInstanceId: workforce.id },
          });
        }

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

        return tx.workforceInstance.findUniqueOrThrow({
          where: { id: workforce.id },
          include: { orchestrator: true, members: true },
        });
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
    const orchestrator = await this.findValidOrchestrator(organizationId, dto.orchestratorEmployeeId);

    if (orchestrator?.workforceInstanceId && orchestrator.workforceInstanceId !== id) {
      throw new ConflictException('Der Orchestrator gehört bereits zu einer anderen WorkforceInstance.');
    }

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
        });

        if (dto.orchestratorEmployeeId) {
          await tx.digitalEmployee.update({
            where: { id: dto.orchestratorEmployeeId },
            data: { workforceInstanceId: id },
          });
        }

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

        return tx.workforceInstance.findUniqueOrThrow({
          where: { id },
          include: { orchestrator: true, members: true },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Eine WorkforceInstance mit diesem code existiert bereits in dieser Organization.');
      }
      throw err;
    }
  }

  private async findValidOrchestrator(organizationId: string, orchestratorEmployeeId?: string) {
    if (!orchestratorEmployeeId) return null;

    const orchestrator = await this.prisma.digitalEmployee.findFirst({
      where: {
        id: orchestratorEmployeeId,
        organizationId,
        employeeType: EmployeeType.ORCHESTRATOR,
      },
      select: { id: true, workforceInstanceId: true },
    });

    if (!orchestrator) {
      throw new NotFoundException('Der Orchestrator existiert nicht in dieser Organization oder ist kein ORCHESTRATOR.');
    }

    return orchestrator;
  }
}
