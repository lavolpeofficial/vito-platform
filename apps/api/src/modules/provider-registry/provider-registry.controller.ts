import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderRouterService } from './provider-router.service';
import type { ProviderRoutingRequest } from '@vito/contracts';

/**
 * Provider Registry & Router API (EO-01.3).
 *
 * Minimale REST-Endpoints für Provider-Verwaltung und Routing.
 * Tenant-Scoping über X-Organization-Id Header (Development-Fallback)
 * oder JWT-based Auth.
 */
@Controller('provider-registry')
export class ProviderRegistryController {
  constructor(
    private readonly registryService: ProviderRegistryService,
    private readonly routerService: ProviderRouterService,
  ) {}

  // -------------------------------------------------------------------------
  // Provider CRUD
  // -------------------------------------------------------------------------

  @Post('providers')
  createProvider(
    @Query('organizationId') organizationId: string,
    @Body() body: {
      providerCode: string;
      displayName: string;
      providerType?: string;
      status?: string;
      modelFamily?: string;
      modelName?: string;
      modelCode?: string;
      supportedCapabilities: string[];
      estimatedCostMinorUnits?: number | null;
      healthStatus?: string;
      quotaStatus?: string;
      qualityScore?: number;
      latencyScore?: number;
      costScore?: number;
      costMetadata?: Record<string, unknown>;
      assuranceLevels?: string[];
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.registryService.createProvider({ organizationId, ...body });
  }

  @Get('providers')
  findAllProviders(@Query('organizationId') organizationId: string) {
    return this.registryService.findAllProviders(organizationId);
  }

  @Get('providers/:providerId')
  findProvider(
    @Query('organizationId') organizationId: string,
    @Param('providerId') providerId: string,
  ) {
    return this.registryService.findProviderById(organizationId, providerId);
  }

  @Patch('providers/:providerId')
  updateProvider(
    @Query('organizationId') organizationId: string,
    @Param('providerId') providerId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.registryService.updateProvider({
      organizationId,
      providerId,
      ...body,
    } as any);
  }

  @Patch('providers/:providerId/health')
  updateHealthStatus(
    @Query('organizationId') organizationId: string,
    @Param('providerId') providerId: string,
    @Body() body: { healthStatus: string },
  ) {
    return this.registryService.updateHealthStatus(
      organizationId,
      providerId,
      body.healthStatus,
    );
  }

  @Patch('providers/:providerId/quota')
  updateQuotaStatus(
    @Query('organizationId') organizationId: string,
    @Param('providerId') providerId: string,
    @Body() body: { quotaStatus: string },
  ) {
    return this.registryService.updateQuotaStatus(
      organizationId,
      providerId,
      body.quotaStatus,
    );
  }

  // -------------------------------------------------------------------------
  // Durable ProviderCapability Assignments
  // -------------------------------------------------------------------------

  @Post('providers/:providerId/capabilities')
  assignCapability(
    @Query('organizationId') organizationId: string,
    @Param('providerId') providerId: string,
    @Body() body: { capabilityCode: string; isEnabled?: boolean },
  ) {
    return this.registryService.assignCapability({
      organizationId,
      agentProviderId: providerId,
      capabilityCode: body.capabilityCode,
      isEnabled: body.isEnabled,
    });
  }

  @Get('providers/:providerId/capabilities')
  listCapabilities(
    @Query('organizationId') organizationId: string,
    @Param('providerId') providerId: string,
  ) {
    return this.registryService.listCapabilities(organizationId, providerId);
  }

  @Patch('capabilities/:capabilityId')
  setCapabilityEnabled(
    @Query('organizationId') organizationId: string,
    @Param('capabilityId') capabilityId: string,
    @Body() body: { isEnabled: boolean },
  ) {
    return this.registryService.setCapabilityEnabled(
      organizationId,
      capabilityId,
      body.isEnabled,
    );
  }

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------

  @Post('route')
  route(
    @Query('organizationId') organizationId: string,
    @Body() body: {
      capability: string;
      assuranceLevel?: string;
      workflowRunId?: string;
      workflowStepRunId?: string;
      independenceContext?: {
        builderProviderId?: string;
        builderModelFamily?: string;
        previousReviewerProviderIds?: string[];
        previousReviewerModelFamilies?: string[];
      };
      budget?: {
        maxCostMinorUnits?: number;
        currency?: string;
      };
      correlationId?: string;
    },
  ) {
    const request: ProviderRoutingRequest = {
      organizationId,
      capability: body.capability,
      assuranceLevel: body.assuranceLevel,
      workflowRunId: body.workflowRunId,
      workflowStepRunId: body.workflowStepRunId,
      independenceContext: body.independenceContext
        ? {
            ...body.independenceContext,
            previousReviewerProviderIds: body.independenceContext.previousReviewerProviderIds ?? [],
            previousReviewerModelFamilies: body.independenceContext.previousReviewerModelFamilies ?? [],
          }
        : undefined,
      budget: body.budget,
      correlationId: body.correlationId ?? crypto.randomUUID(),
    };
    return this.routerService.route(request);
  }

  // -------------------------------------------------------------------------
  // Decision Queries
  // -------------------------------------------------------------------------

  @Get('decisions/:decisionId')
  findDecision(
    @Query('organizationId') organizationId: string,
    @Param('decisionId') decisionId: string,
  ) {
    return this.routerService.findDecisionById(organizationId, decisionId);
  }

  @Get('decisions')
  findDecisions(
    @Query('organizationId') organizationId: string,
    @Query('correlationId') correlationId?: string,
    @Query('workflowRunId') workflowRunId?: string,
  ) {
    if (correlationId) {
      return this.routerService.findDecisionsByCorrelationId(organizationId, correlationId);
    }
    if (workflowRunId) {
      return this.routerService.findDecisionsByWorkflowRunId(organizationId, workflowRunId);
    }
    return [];
  }
}
