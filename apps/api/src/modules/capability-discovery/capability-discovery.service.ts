import { BadRequestException, Injectable } from '@nestjs/common';
import { EngineeringCapability } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';

export type CapabilityAvailability = 'AVAILABLE' | 'REGISTERED_UNROUTABLE' | 'CANDIDATE_ONLY' | 'MISSING';

interface SkillCandidateRow {
  id: string;
  code: string;
  name: string;
  status: string;
  confidence: number;
}

const OFFICIAL_ENGINEERING_CAPABILITIES = new Set<string>(Object.values(EngineeringCapability));

@Injectable()
export class CapabilityDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async assess(organizationId: string, rawCode: string) {
    const code = rawCode?.trim().toUpperCase();
    if (!code) throw new BadRequestException('capability code is required.');
    if (code.length > 128) throw new BadRequestException('capability code is too long.');

    const [registered, providerBindings, skillCandidates] = await Promise.all([
      this.prisma.capability.findFirst({
        where: { organizationId, code },
        include: {
          digitalEmployees: {
            where: { isEnabled: true },
            select: { digitalEmployeeId: true },
          },
        },
      }),
      this.prisma.providerCapability.findMany({
        where: {
          organizationId,
          capabilityCode: code,
          isEnabled: true,
          agentProvider: { status: 'ACTIVE' },
        },
        select: {
          agentProviderId: true,
          agentProvider: { select: { providerCode: true, healthStatus: true, quotaStatus: true } },
        },
      }),
      this.prisma.$queryRaw<SkillCandidateRow[]>`
        SELECT "id", "code", "name", "status", "confidence"
        FROM "skill_candidates"
        WHERE "organization_id" = ${organizationId}
          AND upper("code") = ${code}
          AND "status" = 'RECORDED'
        ORDER BY "created_at" DESC
        LIMIT 5
      `,
    ]);

    const officialEngineeringCapability = OFFICIAL_ENGINEERING_CAPABILITIES.has(code);
    const executableProviderCount = providerBindings.length;
    const assignedDigitalEmployeeCount = registered?.digitalEmployees.length ?? 0;

    let availability: CapabilityAvailability;
    if (executableProviderCount > 0) availability = 'AVAILABLE';
    else if (registered || officialEngineeringCapability) availability = 'REGISTERED_UNROUTABLE';
    else if (skillCandidates.length > 0) availability = 'CANDIDATE_ONLY';
    else availability = 'MISSING';

    return Object.freeze({
      code,
      availability,
      officialEngineeringCapability,
      registeredCapability: registered
        ? {
            id: registered.id,
            name: registered.name,
            riskLevel: registered.riskLevel,
            requiresApproval: registered.requiresApproval,
          }
        : null,
      assignedDigitalEmployeeCount,
      executableProviders: providerBindings.map((binding) => ({
        providerId: binding.agentProviderId,
        providerCode: binding.agentProvider.providerCode,
        healthStatus: binding.agentProvider.healthStatus,
        quotaStatus: binding.agentProvider.quotaStatus,
      })),
      skillCandidates,
      gap: availability === 'MISSING'
        ? { type: 'CAPABILITY_MISSING' as const, suggestedNextState: 'SKILL_CANDIDATE' as const }
        : availability === 'CANDIDATE_ONLY'
          ? { type: 'CAPABILITY_NOT_ACTIVATED' as const, suggestedNextState: 'HUMAN_GOVERNANCE_REVIEW' as const }
          : availability === 'REGISTERED_UNROUTABLE'
            ? { type: 'NO_EXECUTABLE_PROVIDER' as const, suggestedNextState: 'PROVIDER_OR_ASSIGNMENT_REVIEW' as const }
            : null,
    });
  }
}
