import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrganizationRoleDto } from './dto/create-organization-role.dto';
import { UpdateOrganizationRoleDto } from './dto/update-organization-role.dto';

@Injectable()
export class OrganizationRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateOrganizationRoleDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const role = await tx.organizationRole.create({
          data: {
            organizationId,
            code: dto.code,
            name: dto.name,
            description: dto.description,
            status: dto.status,
            responsibilities: dto.responsibilities ?? [],
          },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'ORGANIZATION_ROLE_CREATED',
            entityType: 'OrganizationRole',
            entityId: role.id,
            metadata: { code: role.code },
          },
          tx,
        );

        return role;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Eine Organization Role mit diesem code existiert bereits.');
      }
      throw error;
    }
  }

  findAll(organizationId: string) {
    return this.prisma.organizationRole.findMany({
      where: { organizationId },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const role = await this.prisma.organizationRole.findFirst({
      where: { id, organizationId },
    });

    if (!role) {
      throw new NotFoundException('Organization Role nicht gefunden.');
    }

    return role;
  }

  async update(organizationId: string, id: string, dto: UpdateOrganizationRoleDto) {
    await this.findByIdOrFail(organizationId, id);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const role = await tx.organizationRole.update({
          where: { id },
          data: {
            ...dto,
            responsibilities: dto.responsibilities,
          },
        });

        await this.auditService.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'ORGANIZATION_ROLE_UPDATED',
            entityType: 'OrganizationRole',
            entityId: role.id,
            metadata: { changes: dto },
          },
          tx,
        );

        return role;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Eine Organization Role mit diesem code existiert bereits.');
      }
      throw error;
    }
  }
}
