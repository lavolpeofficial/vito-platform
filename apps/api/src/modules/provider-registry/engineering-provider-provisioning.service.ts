import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EngineeringCapability } from '@vito/contracts';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ProviderRegistryService } from './provider-registry.service';

const ENGINEERING_PROVIDER = Object.freeze({
  providerCode: 'cloud.openai.main',
  displayName: 'OpenAI Cloud Coding',
  providerType: 'CLOUD_LLM',
  status: 'DISABLED',
  credentialRequirement: 'REQUIRED',
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
    private readonly registry: ProviderRegistryService,
    private readonly tenantContext: TenantContext,
  ) {}

  async provision() {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('Engineering provider provisioning requires authenticated human governance.');
    }

    let provider = await this.registry.findProviderByCode(organizationId, ENGINEERING_PROVIDER.providerCode);
    if (provider) {
      const supported = Array.isArray(provider.supportedCapabilities)
        ? provider.supportedCapabilities.filter((value): value is string => typeof value === 'string')
        : [];
      const expected = [...ENGINEERING_PROVIDER.capabilities];
      const exactCapabilities =
        supported.length === expected.length && expected.every((capability) => supported.includes(capability));

      if (
        provider.status !== ENGINEERING_PROVIDER.status ||
        provider.providerType !== ENGINEERING_PROVIDER.providerType ||
        provider.credentialRequirement !== ENGINEERING_PROVIDER.credentialRequirement ||
        provider.modelFamily !== ENGINEERING_PROVIDER.modelFamily ||
        !exactCapabilities
      ) {
        throw new ConflictException('Existing cloud.openai.main does not match the governed DISABLED engineering provider bootstrap.');
      }
    } else {
      provider = await this.registry.createProvider({
        organizationId,
        providerCode: ENGINEERING_PROVIDER.providerCode,
        displayName: ENGINEERING_PROVIDER.displayName,
        providerType: ENGINEERING_PROVIDER.providerType,
        status: ENGINEERING_PROVIDER.status,
        credentialRequirement: ENGINEERING_PROVIDER.credentialRequirement,
        modelFamily: ENGINEERING_PROVIDER.modelFamily,
        supportedCapabilities: ENGINEERING_PROVIDER.capabilities,
        assuranceLevels: ENGINEERING_PROVIDER.assuranceLevels,
        metadata: {
          serverOwned: true,
          purpose: 'vito-engineering-builder',
          requiresExplicitActivation: true,
        },
      });
    }

    const existingCapabilities = await this.registry.listCapabilities(organizationId, provider.id);
    for (const existing of existingCapabilities) {
      if (!ENGINEERING_PROVIDER.capabilities.includes(existing.capabilityCode as EngineeringCapability)) {
        throw new ConflictException(`Unexpected provider capability ${existing.capabilityCode} on cloud.openai.main.`);
      }
      if (existing.isEnabled) {
        throw new ConflictException(`Provider capability ${existing.capabilityCode} is already enabled; bootstrap will not modify active authority.`);
      }
    }

    const existingCodes = new Set(existingCapabilities.map((item) => item.capabilityCode));
    for (const capabilityCode of ENGINEERING_PROVIDER.capabilities) {
      if (!existingCodes.has(capabilityCode)) {
        await this.registry.assignCapability({
          organizationId,
          agentProviderId: provider.id,
          capabilityCode,
          isEnabled: false,
        });
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
  }
}
