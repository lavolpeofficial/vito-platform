import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { HumanReleaseApprovalService } from './human-release-approval.service';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@ApiTags('workflow-runtime')
@ApiBearerAuth()
@Controller('workflow-runtime')
export class WorkflowRuntimeController {
  constructor(
    private readonly service: WorkflowRuntimeService,
    private readonly humanReleaseApproval: HumanReleaseApprovalService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post(':workflowRunId/start')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Starts an existing CREATED workflow run. No human gate is approved or bypassed.' })
  start(@Param('workflowRunId') workflowRunId: string) {
    return this.service.startRun(this.tenantContext.getOrThrow(), workflowRunId);
  }

  @Post(':workflowRunId/resume')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Resumes a blocked workflow run. Provider-blocked steps are returned to READY; no execution is triggered automatically.' })
  resume(@Param('workflowRunId') workflowRunId: string) {
    return this.service.resumeRun(this.tenantContext.getOrThrow(), workflowRunId);
  }

  @Post(':workflowRunId/human-release-approval')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Explicitly approves a READY HUMAN_RELEASE_GATE for the authenticated human user and advances only to RELEASE_EXECUTION. No release execution is triggered automatically.',
  })
  approveHumanRelease(
    @Param('workflowRunId') workflowRunId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return this.humanReleaseApproval.approve({
      organizationId: this.tenantContext.getOrThrow(),
      workflowRunId,
      approvedByUserId: request.user.userId,
      isMachineIdentity: request.user.isMachineIdentity,
    });
  }
}
