import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ActivateDigitalEmployeeDto } from './dto/activate-digital-employee.dto';
import { CreateDigitalEmployeeDto } from './dto/create-digital-employee.dto';
import { UpdateDigitalEmployeeDto } from './dto/update-digital-employee.dto';

@Injectable()
export class DigitalEmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateDigitalEmployeeDto) {
    if (dto.status === 'ACTIVE') {
      throw new BadRequestException('DigitalEmployees must pass the activation gate before becoming ACTIVE.');
    }
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
        await this.auditService.record({ organizationId, actorType: 'SYSTEM', action: 'DIGITAL_EMPLOYEE_CREATED', entityType: 'DigitalEmployee', entityId: digitalEmployee.id, metadata: { code: digitalEmployee.code, employeeType: digitalEmployee.employeeType } }, tx);
        return digitalEmployee;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictException('Ein DigitalEmployee mit diesem code existiert bereits in dieser Organization.');
      throw err;
    }
  }

  async findAll(organizationId: string) {
    return this.prisma.digitalEmployee.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' }, include: { capabilities: { include: { capability: true } } } });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const digitalEmployee = await this.prisma.digitalEmployee.findFirst({ where: { id, organizationId }, include: { capabilities: { include: { capability: true } } } });
    if (!digitalEmployee) throw new NotFoundException('DigitalEmployee nicht gefunden.');
    return digitalEmployee;
  }

  async update(organizationId: string, id: string, dto: UpdateDigitalEmployeeDto) {
    await this.findByIdOrFail(organizationId, id);
    if (dto.status === 'ACTIVE') throw new BadRequestException('Direct activation is forbidden. Use the activation gate endpoint.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.digitalEmployee.update({ where: { id }, data: { name: dto.name, description: dto.description, employeeType: dto.employeeType, status: dto.status, version: dto.version } });
      await this.auditService.record({ organizationId, actorType: 'SYSTEM', action: 'DIGITAL_EMPLOYEE_UPDATED', entityType: 'DigitalEmployee', entityId: updated.id, metadata: { changes: dto } }, tx);
      return updated;
    });
  }

  async activate(organizationId: string, id: string, dto: ActivateDigitalEmployeeDto) {
    const employee = await this.findByIdOrFail(organizationId, id);
    if (employee.status !== 'DRAFT' && employee.status !== 'PAUSED') throw new BadRequestException(`Only DRAFT or PAUSED employees may be activated. Current status: ${employee.status}`);
    if (!dto.capabilitiesReviewed || !dto.dataAccessReviewed) throw new BadRequestException('Capabilities and data access must be explicitly reviewed before activation.');
    if (employee.capabilities.length === 0) throw new BadRequestException('At least one capability must be assigned before activation.');
    const enabled = employee.capabilities.filter((assignment) => assignment.isEnabled);
    if (enabled.length === 0) throw new BadRequestException('At least one capability must be explicitly enabled before activation.');
    const unsafe = enabled.filter(({ capability }) => (capability.riskLevel === 'HIGH' || capability.riskLevel === 'CRITICAL') && !capability.requiresApproval);
    if (unsafe.length > 0) throw new BadRequestException(`High-risk capabilities must require approval: ${unsafe.map((x) => x.capability.code).join(', ')}`);

    return this.prisma.$transaction(async (tx) => {
      const activated = await tx.digitalEmployee.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.auditService.record({
        organizationId,
        actorType: 'SYSTEM',
        action: 'DIGITAL_EMPLOYEE_ACTIVATED',
        entityType: 'DigitalEmployee',
        entityId: id,
        metadata: {
          approvalNote: dto.approvalNote,
          capabilitiesReviewed: true,
          dataAccessReviewed: true,
          enabledCapabilityCodes: enabled.map((x) => x.capability.code),
          activationGateVersion: '0.1.0',
        },
      }, tx);
      return activated;
    });
  }

  async assertBelongsToOrganization(organizationId: string, digitalEmployeeId: string): Promise<void> {
    const digitalEmployee = await this.prisma.digitalEmployee.findFirst({ where: { id: digitalEmployeeId, organizationId }, select: { id: true } });
    if (!digitalEmployee) throw new NotFoundException('Zugewiesener DigitalEmployee existiert nicht in dieser Organization.');
  }
}
