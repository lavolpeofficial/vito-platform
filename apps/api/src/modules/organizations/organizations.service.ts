import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Seit Sprint 2.1 bietet dieser Service bewusst KEINE create()-Methode
 * mehr an — siehe OrganizationsController und ADR-001 ("Deaktivierung
 * von POST /organizations"). Organizations entstehen ausschließlich über
 * den Seed-/Bootstrap-Prozess (direkter Prisma-Zugriff in prisma/seed.ts),
 * nicht über einen API-Layer.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id } });
    if (!organization) {
      throw new NotFoundException('Organization nicht gefunden.');
    }
    return organization;
  }
}
