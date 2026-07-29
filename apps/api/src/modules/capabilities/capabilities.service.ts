import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DigitalEmployeesService } from '../digital-employees/digital-employees.service';
import { CreateCapabilityDto } from './dto/create-capability.dto';
import { GrantCapabilityDto } from './dto/grant-capability.dto';

@Injectable()
export class CapabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly digitalEmployeesService: DigitalEmployeesService,
  ) {}

  async create(organizationId: string, dto: CreateCapabilityDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const capability = await tx.capability.create({
          data: {
            organizationId,
            code: dto.code,
            name: dto.name,
            description: dto.description,
            riskLevel: dto.riskLevel,
            requiresApproval: dto.requiresApproval,
          },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'CAPABILITY_CREATED',
            entityType: 'Capability',
            entityId: capability.id,
            metadata: { code: capability.code, riskLevel: capability.riskLevel },
          },
          tx,
        );

        return capability;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Eine Capability mit diesem code existiert bereits in dieser Organization.');
      }
      throw err;
    }
  }

  async findAll(organizationId: string) {
    return this.prisma.capability.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const capability = await this.prisma.capability.findFirst({ where: { id, organizationId } });
    if (!capability) {
      throw new NotFoundException('Capability nicht gefunden.');
    }
    return capability;
  }

  async grantToDigitalEmployee(
    organizationId: string,
    digitalEmployeeId: string,
    capabilityId: string,
    dto: GrantCapabilityDto,
  ) {
    await this.digitalEmployeesService.assertBelongsToOrganization(organizationId, digitalEmployeeId);
    await this.findByIdOrFail(organizationId, capabilityId);

    return this.prisma.$transaction(async (tx) => {
      const link = await tx.digitalEmployeeCapability.upsert({
        where: {
          digitalEmployeeId_capabilityId: { digitalEmployeeId, capabilityId },
        },
        create: {
          digitalEmployeeId,
          capabilityId,
          isEnabled: dto.isEnabled ?? true,
          configuration: (dto.configuration ?? {}) as Prisma.InputJsonValue,
        },
        update: {
          isEnabled: dto.isEnabled ?? true,
          configuration: (dto.configuration ?? {}) as Prisma.InputJsonValue,
        },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'CAPABILITY_GRANTED',
          entityType: 'DigitalEmployeeCapability',
          entityId: digitalEmployeeId,
          metadata: { digitalEmployeeId, capabilityId, isEnabled: link.isEnabled },
        },
        tx,
      );

      return link;
    });
  }

  async revokeFromDigitalEmployee(organizationId: string, digitalEmployeeId: string, capabilityId: string) {
    await this.digitalEmployeesService.assertBelongsToOrganization(organizationId, digitalEmployeeId);
    await this.findByIdOrFail(organizationId, capabilityId);

    const existing = await this.prisma.digitalEmployeeCapability.findUnique({
      where: { digitalEmployeeId_capabilityId: { digitalEmployeeId, capabilityId } },
    });
    if (!existing) {
      throw new NotFoundException('Diese Capability ist dem DigitalEmployee nicht zugewiesen.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.digitalEmployeeCapability.delete({
        where: { digitalEmployeeId_capabilityId: { digitalEmployeeId, capabilityId } },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'CAPABILITY_REVOKED',
          entityType: 'DigitalEmployeeCapability',
          entityId: digitalEmployeeId,
          metadata: { digitalEmployeeId, capabilityId },
        },
        tx,
      );

      return { digitalEmployeeId, capabilityId, revoked: true };
    });
  }
}
