import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssignWorkforceDto } from './dto/assign-workforce.dto';
import { CreateDigitalEmployeeDto } from './dto/create-digital-employee.dto';
import { UpdateDigitalEmployeeDto } from './dto/update-digital-employee.dto';

@Injectable()
export class DigitalEmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateDigitalEmployeeDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const digitalEmployee = await tx.digitalEmployee.create({
          data: {
            organizationId,
            name: dto.name,
            code: dto.code,
            description: dto.description,
            employeeType: dto.employeeType,
            status: dto.status,
            version: dto.version,
          },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'DIGITAL_EMPLOYEE_CREATED',
            entityType: 'DigitalEmployee',
            entityId: digitalEmployee.id,
            metadata: { code: digitalEmployee.code, employeeType: digitalEmployee.employeeType },
          },
          tx,
        );

        return digitalEmployee;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Ein DigitalEmployee mit diesem code existiert bereits in dieser Organization.');
      }
      throw err;
    }
  }

  async findAll(organizationId: string) {
    return this.prisma.digitalEmployee.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        workforceInstance: true,
        orchestratedWorkforces: true,
        capabilities: { include: { capability: true } },
      },
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const digitalEmployee = await this.prisma.digitalEmployee.findFirst({
      where: { id, organizationId },
      include: {
        workforceInstance: true,
        orchestratedWorkforces: true,
        capabilities: { include: { capability: true } },
      },
    });
    if (!digitalEmployee) {
      throw new NotFoundException('DigitalEmployee nicht gefunden.');
    }
    return digitalEmployee;
  }

  async update(organizationId: string, id: string, dto: UpdateDigitalEmployeeDto) {
    await this.findByIdOrFail(organizationId, id);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.digitalEmployee.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          employeeType: dto.employeeType,
          status: dto.status,
          version: dto.version,
        },
        include: { workforceInstance: true },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'DIGITAL_EMPLOYEE_UPDATED',
          entityType: 'DigitalEmployee',
          entityId: updated.id,
          metadata: { changes: dto },
        },
        tx,
      );

      return updated;
    });
  }

  async assignWorkforce(organizationId: string, id: string, dto: AssignWorkforceDto) {
    const employee = await this.findByIdOrFail(organizationId, id);
    const workforceInstanceId = dto.workforceInstanceId ?? null;

    if (workforceInstanceId) {
      const workforce = await this.prisma.workforceInstance.findFirst({
        where: { id: workforceInstanceId, organizationId },
        select: { id: true },
      });
      if (!workforce) {
        throw new NotFoundException('WorkforceInstance nicht gefunden.');
      }
    }

    if (!workforceInstanceId && employee.orchestratedWorkforces.length) {
      throw new ConflictException(
        'Ein als Orchestrator verwendeter DigitalEmployee kann nicht aus seiner Workforce entfernt werden.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.digitalEmployee.update({
        where: { id },
        data: { workforceInstanceId },
        include: { workforceInstance: true },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: workforceInstanceId ? 'DIGITAL_EMPLOYEE_ASSIGNED_TO_WORKFORCE' : 'DIGITAL_EMPLOYEE_REMOVED_FROM_WORKFORCE',
          entityType: 'DigitalEmployee',
          entityId: updated.id,
          metadata: {
            previousWorkforceInstanceId: employee.workforceInstanceId,
            workforceInstanceId,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Prüft, dass ein DigitalEmployee existiert und derselben Organization
   * angehört. Wird u. a. von TasksService für Zuweisungsvalidierung genutzt.
   */
  async assertBelongsToOrganization(organizationId: string, digitalEmployeeId: string): Promise<void> {
    const digitalEmployee = await this.prisma.digitalEmployee.findFirst({
      where: { id: digitalEmployeeId, organizationId },
      select: { id: true },
    });
    if (!digitalEmployee) {
      throw new NotFoundException('Zugewiesener DigitalEmployee existiert nicht in dieser Organization.');
    }
  }
}
