import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';

@ApiTags('workflow-agent-runtime')
@ApiBearerAuth()
@Controller('workflow-agent-runtime')
export class WorkflowAgentRuntimeController {
  constructor(
    private readonly service: WorkflowAgentRuntimeService,
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
}
