import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma, RiskLevel } from '@prisma/client';
import { EngineeringCapability } from '@vito/contracts';
import { TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const EMPLOYEE_CODE = 'vito-engineer';
const EMPLOYEE_NAME = 'VITO Engineer';
const PROVIDER_CODE = 'cloud.openai.main';
const CAPABILITY = Object.freeze({
  code: EngineeringCapability.RELEASE_VERIFICATION,
  name: 'Release verification',
  description: 'Server-owned engineering capability RELEASE_VERIFICATION.',
  riskLevel: RiskLevel.MEDIUM,
  requiresApproval: false,
});

const LEGACY_BASE_CAPABILITIES = Object.freeze([
  EngineeringCapability.CODE_PLAN,
  EngineeringCapability.CODE_BUILD,
  EngineeringCapability.TEST_EXECUTION,
  EngineeringCapability.REVIEW_PACKAGE,
  EngineeringCapability.RED_TEAM,
]);

const EXPECTED_PROVIDER_CAPABILITIES = Object.freeze([
  ...LEGACY_BASE_CAPABILITIES,
  EngineeringCapability.RELEASE_VERIFICATION,
]);

function exactSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

@Injectable()
export class ReleaseVerificationProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async provision() {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('RELEASE_VERIFICATION provisioning requires authenticated human governance.');
    }

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.digitalEmployee.findFirst({
        where: { organizationId, code: EMPLOYEE_CODE },
      });
      if (
        !employee ||
        employee.name !== EMPLOYEE_NAME ||
        employee.employeeType !== 'SPECIALIST' ||
        !['DRAFT', 'ACTIVE'].includes(employee.status)
      ) {
        throw new ConflictException('Existing vito-engineer is not compatible with additive RELEASE_VERIFICATION provisioning.');
      }

      const provider = await tx.agentProvider.findFirst({
        where: { organizationId, providerCode: PROVIDER_CODE },
      });
      if (
        !provider ||
        provider.providerType !== 'CLOUD_LLM' ||
        provider.modelFamily !== 'openai' ||
        !['DISABLED', 'ACTIVE'].includes(provider.status)
      ) {
        throw new ConflictException('Existing cloud.openai.main is not compatible with additive RELEASE_VERIFICATION provisioning.');
      }

      const supported = Array.isArray(provider.supportedCapabilities)
        ? provider.supportedCapabilities.filter((value): value is string => typeof value === 'string')
        : [];
      const metadataIsLegacyBase = exactSet(supported, LEGACY_BASE_CAPABILITIES);
      const metadataAlreadyCurrent = exactSet(supported, EXPECTED_PROVIDER_CAPABILITIES);
      if (!metadataIsLegacyBase && !metadataAlreadyCurrent) {
        throw new ConflictException('Provider supportedCapabilities is not an exact governed pre- or post-#158 set.');
      }

      let capability = await tx.capability.findFirst({
        where: { organizationId, code: CAPABILITY.code },
      });
      if (capability) {
        if (
          capability.riskLevel !== CAPABILITY.riskLevel ||
          capability.requiresApproval !== CAPABILITY.requiresApproval
        ) {
          throw new ConflictException('Existing RELEASE_VERIFICATION capability conflicts with governed declaration.');
        }
      } else {
        capability = await tx.capability.create({
          data: {
            organizationId,
            code: CAPABILITY.code,
            name: CAPABILITY.name,
            description: CAPABILITY.description,
            riskLevel: CAPABILITY.riskLevel,
            requiresApproval: CAPABILITY.requiresApproval,
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: userId,
            action: 'CAPABILITY_CREATED',
            entityType: 'Capability',
            entityId: capability.id,
            metadata: { code: CAPABILITY.code, riskLevel: CAPABILITY.riskLevel, requiresApproval: false },
          },
          tx,
        );
      }

      let employeeLink = await tx.digitalEmployeeCapability.findUnique({
        where: {
          digitalEmployeeId_capabilityId: {
            digitalEmployeeId: employee.id,
            capabilityId: capability.id,
          },
        },
      });
      if (employeeLink?.isEnabled) {
        throw new ConflictException('RELEASE_VERIFICATION is already enabled for vito-engineer; additive provisioning will not alter active authority.');
      }
      if (!employeeLink) {
        employeeLink = await tx.digitalEmployeeCapability.create({
          data: {
            digitalEmployeeId: employee.id,
            capabilityId: capability.id,
            isEnabled: false,
            configuration: {},
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: userId,
            action: 'CAPABILITY_GRANTED',
            entityType: 'DigitalEmployeeCapability',
            entityId: employee.id,
            metadata: { digitalEmployeeId: employee.id, capabilityId: capability.id, capabilityCode: CAPABILITY.code, isEnabled: false },
          },
          tx,
        );
      }

      let providerLink = await tx.providerCapability.findUnique({
        where: {
          organizationId_agentProviderId_capabilityCode: {
            organizationId,
            agentProviderId: provider.id,
            capabilityCode: CAPABILITY.code,
          },
        },
      });
      if (providerLink?.isEnabled) {
        throw new ConflictException('RELEASE_VERIFICATION is already enabled for cloud.openai.main; additive provisioning will not alter active authority.');
      }
      if (!providerLink) {
        providerLink = await tx.providerCapability.create({
          data: {
            organizationId,
            agentProviderId: provider.id,
            capabilityCode: CAPABILITY.code,
            isEnabled: false,
          },
        });
        await this.audit.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: userId,
            action: 'PROVIDER_CAPABILITY_ASSIGNED',
            entityType: 'ProviderCapability',
            entityId: providerLink.id,
            metadata: { agentProviderId: provider.id, providerCode: PROVIDER_CODE, capabilityCode: CAPABILITY.code, isEnabled: false },
          },
          tx,
        );
      }

      let providerMetadataUpdated = false;
      if (metadataIsLegacyBase) {
        await tx.agentProvider.update({
          where: { id: provider.id },
          data: {
            supportedCapabilities: [...EXPECTED_PROVIDER_CAPABILITIES] as Prisma.InputJsonValue,
          },
        });
        providerMetadataUpdated = true;
        await this.audit.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: userId,
            action: 'PROVIDER_UPDATED',
            entityType: 'AgentProvider',
            entityId: provider.id,
            metadata: {
              providerCode: PROVIDER_CODE,
              updatedFields: ['supportedCapabilities'],
              supportedCapabilities: EXPECTED_PROVIDER_CAPABILITIES,
            },
          },
          tx,
        );
      }

      await this.audit.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: userId,
          action: 'ENGINEERING_RELEASE_VERIFICATION_PROVISIONED',
          entityType: 'Capability',
          entityId: capability.id,
          metadata: {
            capabilityCode: CAPABILITY.code,
            digitalEmployeeId: employee.id,
            digitalEmployeeStatus: employee.status,
            employeeCapabilityEnabled: employeeLink.isEnabled,
            providerId: provider.id,
            providerStatus: provider.status,
            providerCapabilityEnabled: providerLink.isEnabled,
            providerMetadataUpdated,
            existingAuthorityPreserved: true,
          },
        },
        tx,
      );

      return Object.freeze({
        capabilityId: capability.id,
        capabilityCode: CAPABILITY.code,
        riskLevel: CAPABILITY.riskLevel,
        requiresApproval: CAPABILITY.requiresApproval,
        digitalEmployeeId: employee.id,
        digitalEmployeeStatus: employee.status,
        employeeCapabilityEnabled: employeeLink.isEnabled,
        providerId: provider.id,
        providerStatus: provider.status,
        providerCapabilityEnabled: providerLink.isEnabled,
        supportedCapabilities: EXPECTED_PROVIDER_CAPABILITIES,
        providerMetadataUpdated,
        existingAuthorityPreserved: true,
      });
    });
  }
}
