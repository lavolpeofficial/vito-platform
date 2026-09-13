import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { ProviderRoutingRequest } from '@vito/contracts';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderRouterService } from './provider-router.service';

@ApiTags('provider-registry')
@ApiBearerAuth()
@Controller('provider-registry')
export class ProviderRegistryController {
  constructor(
    private readonly registryService: ProviderRegistryService,
    private readonly routerService: ProviderRouterService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('providers')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createProvider(@Body() body: {
    providerCode: string; displayName: string; providerType?: string; status?: string;
    modelFamily?: string; modelName?: string; modelCode?: string; supportedCapabilities: string[];
    estimatedCostMinorUnits?: number | null; healthStatus?: string; quotaStatus?: string;
    qualityScore?: number; latencyScore?: number; costScore?: number;
    costMetadata?: Record<string, unknown>; assuranceLevels?: string[]; metadata?: Record<string, unknown>;
  }) {
    return this.registryService.createProvider({ organizationId: this.tenantContext.getOrThrow(), ...body });
  }

  @Get('providers')
  findAllProviders() {
    return this.registryService.findAllProviders(this.tenantContext.getOrThrow());
  }

  @Get('providers/:providerId')
  findProvider(@Param('providerId') providerId: string) {
    return this.registryService.findProviderById(this.tenantContext.getOrThrow(), providerId);
  }

  @Patch('providers/:providerId')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updateProvider(@Param('providerId') providerId: string, @Body() body: Record<string, unknown>) {
    return this.registryService.updateProvider({ organizationId: this.tenantContext.getOrThrow(), providerId, ...body } as any);
  }

  @Patch('providers/:providerId/health')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updateHealthStatus(@Param('providerId') providerId: string, @Body() body: { healthStatus: string }) {
    return this.registryService.updateHealthStatus(this.tenantContext.getOrThrow(), providerId, body.healthStatus);
  }

  @Patch('providers/:providerId/quota')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  updateQuotaStatus(@Param('providerId') providerId: string, @Body() body: { quotaStatus: string }) {
    return this.registryService.updateQuotaStatus(this.tenantContext.getOrThrow(), providerId, body.quotaStatus);
  }

  @Post('providers/:providerId/capabilities')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  assignCapability(@Param('providerId') providerId: string, @Body() body: { capabilityCode: string; isEnabled?: boolean }) {
    return this.registryService.assignCapability({
      organizationId: this.tenantContext.getOrThrow(),
      agentProviderId: providerId,
      capabilityCode: body.capabilityCode,
      isEnabled: body.isEnabled,
    });
  }

  @Get('providers/:providerId/capabilities')
  listCapabilities(@Param('providerId') providerId: string) {
    return this.registryService.listCapabilities(this.tenantContext.getOrThrow(), providerId);
  }

  @Patch('capabilities/:capabilityId')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  setCapabilityEnabled(@Param('capabilityId') capabilityId: string, @Body() body: { isEnabled: boolean }) {
    return this.registryService.setCapabilityEnabled(this.tenantContext.getOrThrow(), capabilityId, body.isEnabled);
  }

  @Post('route')
  route(@Body() body: {
    capability: string; assuranceLevel?: string; workflowRunId?: string; workflowStepRunId?: string;
    independenceContext?: { builderProviderId?: string; builderModelFamily?: string; previousReviewerProviderIds?: string[]; previousReviewerModelFamilies?: string[] };
    budget?: { maxCostMinorUnits?: number; currency?: string }; correlationId?: string;
  }) {
    const request: ProviderRoutingRequest = {
      organizationId: this.tenantContext.getOrThrow(), capability: body.capability,
      assuranceLevel: body.assuranceLevel, workflowRunId: body.workflowRunId, workflowStepRunId: body.workflowStepRunId,
      independenceContext: body.independenceContext ? {
        ...body.independenceContext,
        previousReviewerProviderIds: body.independenceContext.previousReviewerProviderIds ?? [],
        previousReviewerModelFamilies: body.independenceContext.previousReviewerModelFamilies ?? [],
      } : undefined,
      budget: body.budget, correlationId: body.correlationId ?? crypto.randomUUID(),
    };
    return this.routerService.route(request);
  }

  @Get('decisions/:decisionId')
  findDecision(@Param('decisionId') decisionId: string) {
    return this.routerService.findDecisionById(this.tenantContext.getOrThrow(), decisionId);
  }

  @Get('decisions')
  findDecisions(@Query('correlationId') correlationId?: string, @Query('workflowRunId') workflowRunId?: string) {
    const organizationId = this.tenantContext.getOrThrow();
    if (correlationId) return this.routerService.findDecisionsByCorrelationId(organizationId, correlationId);
    if (workflowRunId) return this.routerService.findDecisionsByWorkflowRunId(organizationId, workflowRunId);
    return [];
  }
}
