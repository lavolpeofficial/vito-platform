import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { HumanDecisionCorrectionService } from './human-decision-correction.service';
import { HumanReleaseApprovalService } from './human-release-approval.service';
import { LoopExhaustedTestRecoveryDto } from './dto/loop-exhausted-test-recovery.dto';
import { LoopExhaustedTestRecoveryService } from './loop-exhausted-test-recovery.service';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@ApiTags('workflow-runtime')
@ApiBearerAuth()
@Controller('workflow-runtime')
export class WorkflowRuntimeController {
  constructor(
    private readonly service: WorkflowRuntimeService,
    private readonly humanDecisionCorrection: HumanDecisionCorrectionService,
    private readonly humanReleaseApproval: HumanReleaseApprovalService,
    private readonly loopExhaustedTestRecovery: LoopExhaustedTestRecoveryService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post(':workflowRunId/start')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Starts an existing CREATED workflow run. No human gate is approved or bypassed.' })
  start(@Param('workflowRunId') workflowRunId: string) {
    return this.service.startRun(this.tenantContext.getOrThrow(), workflowRunId);
  }

  @Post(':workflowRunId/cancel')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Explicit human emergency stop. Cancels the run and active steps without triggering further execution.' })
  cancel(
    @Param('workflowRunId') workflowRunId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return this.service.cancelRun({
      organizationId: this.tenantContext.getOrThrow(),
      workflowRunId,
      cancelledByUserId: request.user.userId,
      isMachineIdentity: request.user.isMachineIdentity,
    });
  }

  @Post(':workflowRunId/resume')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Resumes a blocked workflow run. Provider-blocked steps are returned to READY; no execution is triggered automatically.' })
  resume(@Param('workflowRunId') workflowRunId: string) {
    return this.service.resumeRun(this.tenantContext.getOrThrow(), workflowRunId);
  }

  @Post(':workflowRunId/human-decision/correction')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Explicit human decision for a HUMAN_DECISION_REQUIRED block. Atomically creates one READY CORRECTION step and does not trigger execution.',
  })
  requestHumanCorrection(
    @Param('workflowRunId') workflowRunId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return this.humanDecisionCorrection.requestCorrection({
      organizationId: this.tenantContext.getOrThrow(),
      workflowRunId,
      decidedByUserId: request.user.userId,
      isMachineIdentity: request.user.isMachineIdentity,
    });
  }

  @Post(':workflowRunId/human-recovery/loop-exhausted-test')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description:
      'Explicit human recovery for a LOOP_EXHAUSTED workflow. Cancels stale nonterminal steps, creates one fresh READY TEST step from the latest succeeded CORRECTION, preserves the correction-loop count and triggers no execution.',
  })
  recoverLoopExhaustedTest(
    @Param('workflowRunId') workflowRunId: string,
    @Body() dto: LoopExhaustedTestRecoveryDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return this.loopExhaustedTestRecovery.recover({
      organizationId: this.tenantContext.getOrThrow(),
      workflowRunId,
      approvedByUserId: request.user.userId,
      isMachineIdentity: request.user.isMachineIdentity,
      approvalRef: dto.approvalRef,
    });
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
