import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@ApiTags('workflow-runtime')
@ApiBearerAuth()
@Controller('workflow-runtime')
export class WorkflowRuntimeController {
  constructor(
    private readonly service: WorkflowRuntimeService,
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
}
