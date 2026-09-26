import { EngineeringCapability } from '@vito/contracts';
import { ProviderIntelligenceService } from './provider-intelligence.service';

describe('ProviderIntelligenceService', () => {
  const agentProvider = { findMany: jest.fn() };
  const providerRoutingDecision = { findMany: jest.fn() };
  const prisma = { agentProvider, providerRoutingDecision } as any;
  const service = new ProviderIntelligenceService(prisma);

  beforeEach(() => { jest.clearAllMocks(); });

  it('builds tenant-scoped provider readiness and labels cost as current estimate, not billed spend', async () => {
    const capability = Object.values(EngineeringCapability)[0];
    agentProvider.findMany.mockResolvedValue([{ id:'provider-1',providerCode:'p1',displayName:'Provider One',status:'ACTIVE',healthStatus:'HEALTHY',healthCheckedAt:new Date(),quotaStatus:'AVAILABLE',quotaCheckedAt:new Date(),estimatedCostMinorUnits:12,qualityScore:0.9,latencyScore:100,costScore:10,capabilities:[{capabilityCode:capability,isEnabled:true}] }]);
    providerRoutingDecision.findMany.mockResolvedValue([{ id:'decision-1',requestedCapability:capability,selectedProviderId:'provider-1',decisionReason:'selected',routingPolicyVersion:'v1',createdAt:new Date() }]);
    const result=await service.snapshot('org-1');
    expect(result.authority).toBe('READ_ONLY');
    expect(result.providers[0]).toEqual(expect.objectContaining({providerCode:'p1',staticallyRoutable:true}));
    expect(result.capabilityCoverage).toContainEqual(expect.objectContaining({capabilityCode:capability,staticallyRoutableProviderCount:1,readiness:'ROUTABLE_BASELINE'}));
  });

  it('does not classify unknown health or quota as statically routable', async () => {
    agentProvider.findMany.mockResolvedValue([{id:'provider-2',providerCode:'p2',displayName:'Provider Two',status:'ACTIVE',healthStatus:'UNKNOWN',healthCheckedAt:null,quotaStatus:'UNKNOWN',quotaCheckedAt:null,estimatedCostMinorUnits:null,qualityScore:null,latencyScore:null,costScore:null,capabilities:[]}]);
    providerRoutingDecision.findMany.mockResolvedValue([]);
    const result=await service.snapshot('org-1');
    expect(result.providers[0].staticallyRoutable).toBe(false);
  });

  it('surfaces fresh capability redundancy instead of hiding a single-provider SPOF', async () => {
    const capability=EngineeringCapability.CODE_BUILD; const now=new Date();
    agentProvider.findMany.mockResolvedValue([
      {id:'provider-fresh',providerCode:'fresh',displayName:'Fresh',status:'ACTIVE',healthStatus:'HEALTHY',healthCheckedAt:now,quotaStatus:'AVAILABLE',quotaCheckedAt:now,estimatedCostMinorUnits:1,qualityScore:1,latencyScore:1,costScore:1,capabilities:[{capabilityCode:capability,isEnabled:true}]},
      {id:'provider-stale',providerCode:'stale',displayName:'Stale',status:'ACTIVE',healthStatus:'HEALTHY',healthCheckedAt:new Date(0),quotaStatus:'AVAILABLE',quotaCheckedAt:new Date(0),estimatedCostMinorUnits:1,qualityScore:1,latencyScore:1,costScore:1,capabilities:[{capabilityCode:capability,isEnabled:true}]},
    ]);
    providerRoutingDecision.findMany.mockResolvedValue([]);
    const runtimeState={isHealthFresh:jest.fn((p:any)=>p.id==='provider-fresh'),isQuotaFresh:jest.fn((p:any)=>p.id==='provider-fresh')} as any;
    const runtimeAware=new ProviderIntelligenceService(prisma,runtimeState);
    const result=await runtimeAware.snapshot('org-1');
    expect(result.capabilityCoverage).toContainEqual(expect.objectContaining({capabilityCode:capability,enabledProviderCount:2,staticallyRoutableProviderCount:2,freshRoutableProviderCount:1,providerCodes:['fresh'],resilience:'SINGLE_PROVIDER'}));
  });
});
