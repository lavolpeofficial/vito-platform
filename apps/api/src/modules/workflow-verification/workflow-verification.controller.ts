import { Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowVerificationService } from './workflow-verification.service';

@ApiTags('workflow-verification')
@ApiBearerAuth()
@Controller('workflow-verification')
export class WorkflowVerificationController {
  constructor(
    private readonly service: WorkflowVerificationService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post(':workflowRunId/steps/:workflowStepRunId')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Records an objective, evidence-backed verification classification for a persisted workflow step.' })
  verify(
    @Param('workflowRunId') workflowRunId: string,
    @Param('workflowStepRunId') workflowStepRunId: string,
  ) {
    return this.service.verifyStep(this.tenantContext.getOrThrow(), workflowRunId, workflowStepRunId);
  }
}
