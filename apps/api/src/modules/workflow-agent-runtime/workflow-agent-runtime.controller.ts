import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowAgentRunnerService } from './workflow-agent-runner.service';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';
import { WorkflowAl4ReviewCoordinatorService } from './workflow-al4-review-coordinator.service';
import { WorkflowReviewEvidenceService } from './workflow-review-evidence.service';
import { WorkflowReviewVerdictService } from './workflow-review-verdict.service';

@ApiTags('workflow-agent-runtime')
@ApiBearerAuth()
@Controller('workflow-agent-runtime')
export class WorkflowAgentRuntimeController {
  constructor(
    private readonly service: WorkflowAgentRuntimeService,
    private readonly runner: WorkflowAgentRunnerService,
    private readonly al4ReviewCoordinator: WorkflowAl4ReviewCoordinatorService,
    private readonly reviewEvidence: WorkflowReviewEvidenceService,
    private readonly reviewVerdict: WorkflowReviewVerdictService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post(':workflowRunId/execute-current')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Executes the current persisted workflow step through AgentWorkforce.' })
  executeCurrent(@Param('workflowRunId') workflowRunId: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.service.executeCurrentStep(organizationId, workflowRunId);
  }

  @Post(':workflowRunId/execute-until-boundary')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Executes sequential agent-capable workflow steps with a hard budget until a governed boundary is reached.',
  })
  executeUntilBoundary(@Param('workflowRunId') workflowRunId: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.runner.executeUntilBoundary(organizationId, workflowRunId);
  }

  @Post(':workflowRunId/al4-reviews')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Coordinates two independently routed governed AL4 RED_TEAM reviews and persists only typed review evidence and provider/model-family lineage.',
  })
  coordinateAl4Reviews(@Param('workflowRunId') workflowRunId: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.al4ReviewCoordinator.coordinate(organizationId, workflowRunId);
  }

  @Get(':workflowRunId/review-evidence')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({
    description: 'Resolves the authoritative governed RED_TEAM execution evidence lineage without interpreting a verdict.',
  })
  resolveReviewEvidence(@Param('workflowRunId') workflowRunId: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.reviewEvidence.resolve(organizationId, workflowRunId);
  }

  @Post(':workflowRunId/parse-verdict')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Transitions a READY PARSE_VERDICT step only from the persisted typed RED_TEAM ReviewResult bound to authoritative governed execution evidence. AL4 remains fail-closed.',
  })
  parseVerdict(@Param('workflowRunId') workflowRunId: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.reviewVerdict.parseAndTransition(organizationId, workflowRunId);
  }
}
