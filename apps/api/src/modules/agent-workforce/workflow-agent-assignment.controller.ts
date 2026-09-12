import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { EngineeringStepType } from '@vito/contracts';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApproveWorkflowAgentAssignmentDto } from './dto/workflow-agent-assignment.dto';
import { WorkflowAgentAssignmentService } from './workflow-agent-assignment.service';

@ApiTags('workflow-agent-assignments')
@ApiBearerAuth()
@Controller('workflow-agent-assignments')
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class WorkflowAgentAssignmentController {
  constructor(private readonly service: WorkflowAgentAssignmentService) {}

  @Post(':workflowRunId')
  @ApiOkResponse({ description: 'Human-approves an eligible DigitalEmployee for one agent-executable workflow step.' })
  approve(
    @Param('workflowRunId') workflowRunId: string,
    @Body() dto: ApproveWorkflowAgentAssignmentDto,
  ) {
    return this.service.approve({
      workflowRunId,
      stepType: dto.stepType,
      digitalEmployeeId: dto.digitalEmployeeId,
      approvalRef: dto.approvalRef,
    });
  }

  @Delete(':workflowRunId/:stepType')
  @ApiOkResponse({ description: 'Revokes a human-approved workflow-step agent assignment.' })
  revoke(
    @Param('workflowRunId') workflowRunId: string,
    @Param('stepType') stepType: EngineeringStepType,
  ) {
    return this.service.revoke(workflowRunId, stepType);
  }

  @Get(':workflowRunId')
  list(@Param('workflowRunId') workflowRunId: string) {
    return this.service.list(workflowRunId);
  }
}
