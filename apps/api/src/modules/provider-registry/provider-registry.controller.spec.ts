import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ProviderRegistryController } from './provider-registry.controller';

describe('ProviderRegistryController authority boundary', () => {
  const registry = {
    createProvider: jest.fn(), findAllProviders: jest.fn(), findProviderById: jest.fn(),
    updateProvider: jest.fn(), activateProvider: jest.fn(), updateHealthStatus: jest.fn(), updateQuotaStatus: jest.fn(),
    assignCapability: jest.fn(), listCapabilities: jest.fn(), setCapabilityEnabled: jest.fn(),
  };
  const router = {
    route: jest.fn(), findDecisionById: jest.fn(),
    findDecisionsByCorrelationId: jest.fn(), findDecisionsByWorkflowRunId: jest.fn(),
  };
  const engineeringProvisioning = { provision: jest.fn() };
  const tenantContext = { getOrThrow: jest.fn(() => 'org-jwt') };
  const controller = new ProviderRegistryController(
    registry as any,
    router as any,
    engineeringProvisioning as any,
    tenantContext as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('delegates governed engineering provider bootstrap without caller-owned authority input', async () => {
    engineeringProvisioning.provision.mockResolvedValue({
      providerCode: 'cloud.openai.main',
      status: 'DISABLED',
    });

    await expect(controller.provisionEngineeringProvider()).resolves.toEqual({
      providerCode: 'cloud.openai.main',
      status: 'DISABLED',
    });
    expect(engineeringProvisioning.provision).toHaveBeenCalledTimes(1);
  });

  it('derives provider CRUD tenant exclusively from TenantContext', async () => {
    registry.createProvider.mockResolvedValue({ id: 'provider-1' });
    await controller.createProvider({ providerCode: 'p1', displayName: 'P1', supportedCapabilities: [] });
    expect(registry.createProvider).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-jwt' }));

    await controller.findAllProviders();
    expect(registry.findAllProviders).toHaveBeenCalledWith('org-jwt');

    await controller.findProvider('provider-1');
    expect(registry.findProviderById).toHaveBeenCalledWith('org-jwt', 'provider-1');
  });

  it('binds explicit provider activation to TenantContext and forwards only gate evidence', async () => {
    registry.activateProvider.mockResolvedValue({ id: 'provider-1', status: 'ACTIVE' });
    const body = {
      credentialAuthorizationConfirmed: true,
      capabilitiesReviewed: true,
      cloudProfileReviewed: true,
      approvalNote: 'human gate',
    };

    await controller.activateProvider('provider-1', body);

    expect(registry.activateProvider).toHaveBeenCalledWith({
      organizationId: 'org-jwt',
      providerId: 'provider-1',
      ...body,
    });
  });

  it('binds routing and decision queries to TenantContext', async () => {
    await controller.route({ capability: 'CODE_BUILD', correlationId: 'corr-1' });
    expect(router.route).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-jwt', capability: 'CODE_BUILD' }));

    await controller.findDecision('decision-1');
    expect(router.findDecisionById).toHaveBeenCalledWith('org-jwt', 'decision-1');

    await controller.findDecisions('corr-1', undefined);
    expect(router.findDecisionsByCorrelationId).toHaveBeenCalledWith('org-jwt', 'corr-1');
  });

  it.each([
    'provisionEngineeringProvider',
    'createProvider', 'updateProvider', 'activateProvider', 'updateHealthStatus', 'updateQuotaStatus',
    'assignCapability', 'setCapabilityEnabled',
  ])('requires OWNER or ADMIN for mutating handler %s', (handlerName) => {
    const roles = Reflect.getMetadadata(ROLES_KEY, (ProviderRegistryController.prototype as any)[handlerName]);
    expect(roles).toEqual([UserRole.OWNER, UserRole.ADMIN]);
  });

  it.each(['findAllProviders', 'findProvider', 'listCapabilities', 'route', 'findDecision', 'findDecisions'])
  ('does not invent an OWNER/ADMIN role requirement for authenticated read/operational handler %s', (handlerName) => {
    const roles = Reflect.getMetadata(ROLES_KEY, (ProviderRegistryController.prototype as any)[handlerName]);
    expect(roles).toBeUndefined();
  });
});
