import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EngineeringCapability } from '@vito/contracts';
import { TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const ENGINEERING_PROVIDER = Object.freeze({
  providerCode: 'cloud.openai.main',
  displayName: 'OpenAI Cloud Coding',
  providerType: 'CLOUD_LLM',
  status: 'DISABLED',
  modelFamily: 'openai',
  capabilities: Object.freeze([
    EngineeringCapability.CODE_PLAN,
    EngineeringCapability.CODE_BUILD,
    EngineeringCapability.TEST_EXECUTION,
    EngineeringCapability.REVIEW_PACKAGE,
  ]),
  assuranceLevels: Object.freeze(['AL1', 'AL2', 'AL3', 'AL4']),
});

@Injectable()
export class EngineeringProviderProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async provision() {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException(
        'Engineering provider provisioning requires authenticated human governance.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let provider = await tx.agentProvider.findFirst({
        where: {
          organizationId,
          providerCode: ENGINEERING_PROVIDER.providerCode,
        },
      });
      if (provider) {
        const supported = Array.isArray(provider.supportedCapabilities)
          ? provider.supportedCapabilities.filter(
              (value): value is string => typeof value === 'string',
            )
          : [];
        const expected = [...ENGINEERING_PROVIDER.capabilities];
        const exactCapabilities =
          supported.length === expected.length &&
          expected.every((capability) => supported.includes(capability));

        if (
          provider.status !== ENGINEERING_PROVIDER.status ||
          provider.providerType !== ENGINEERING_PROVIDER.providerType ||
          provider.modelFamily !== ENGINEERING_PROVIDER.modelFamily ||
          !exactCapabilities
        ) {
          throw new ConflictException(
            'Existing cloud.openai.main does not match the governed DISABLED engineering provider bootstrap.',
          );
        }
      } else {
        provider = await tx.agentProvider.create({
          data: {
            organizationId,
            providerCode: ENGINEERING_PROVIDER.providerCode,
            displayName: ENGINEERING_PROVIDER.displayName,
            providerType: ENGINEERING_PROVIDER.providerType,
            status: ENGINEERING_PROVIDER.status,
            modelFamily: ENGINEERING_PROVIDER.modelFamily,
            supportedCapabilities: [
              ...ENGINEERING_PROVIDER.capabilities,
            ] as Prisma.InputJsonValue,
            assuranceLevels: [
              ...ENGINEERING_PROVIDER.assuranceLevels,
            ] as Prisma.InputJsonValue,
            metadata: {
              serverOwned: true,
              purpose: 'vito-engineering-builder',
              requiresExplicitActivation: true,
            },
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorType: 'SYSTEM',
            action: 'PROVIDER_REGISTERED',
            entityType: 'AgentProvider',
            entityId: provider.id,
            metadata: {
              providerCode: provider.providerCode,
              displayName: provider.displayName,
              providerType: provider.providerType,
              supportedCapabilities: ENGINEERING_PROVIDER.capabilities,
            },
          },
          tx,
        );
      }

      const existingCapabilities = await tx.providerCapability.findMany({
        where: { organizationId, agentProviderId: provider.id },
        orderBy: [{ capabilityCode: 'asc' }, { agentProviderId: 'asc' }],
      });
      for (const existing of existingCapabilities) {
        if (
          !ENGINEERING_PROVIDER.capabilities.includes(
            existing.capabilityCode as EngineeringCapability,
          )
        ) {
          throw new ConflictException(
            `Unexpected provider capability ${existing.capabilityCode} on cloud.openai.main.`,
          );
        }
        if (existing.isEnabled) {
          throw new ConflictException(
            `Provider capability ${existing.capabilityCode} is already enabled; bootstrap will not modify active authority.`,
          );
        }
      }

      const existingCodes = new Set(
        existingCapabilities.map((item) => item.capabilityCode),
      );
      for (const capabilityCode of ENGINEERING_PROVIDER.capabilities) {
        if (!existingCodes.has(capabilityCode)) {
          const capability = await tx.providerCapability.create({
            data: {
              organizationId,
              agentProviderId: provider.id,
              capabilityCode,
              isEnabled: false,
            },
          });
          await this.audit.record(
            {
              organizationId,
              actorType: 'SYSTEM',
              action: 'PROVIDER_CAPABILITY_ASSIGNED',
              entityType: 'ProviderCapability',
              entityId: capability.id,
              metadata: {
                agentProviderId: provider.id,
                providerCode: provider.providerCode,
                capabilityCode: capability.capabilityCode,
                isEnabled: capability.isEnabled,
              },
            },
            tx,
          );
        }
      }

      return Object.freeze({
        providerId: provider.id,
        providerCode: provider.providerCode,
        status: provider.status,
        capabilityCodes: ENGINEERING_PROVIDER.capabilities,
        capabilitiesEnabled: false,
        cloudProfileEnabled: false,
        requiresExplicitProviderActivation: true,
        requiresCredentialAuthorization: true,
      });
    });
  }
}
