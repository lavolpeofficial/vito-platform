import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AgentWorkforceService } from './agent-workforce.service';
import { DispatchAgentTaskDto } from './dto/dispatch-agent-task.dto';

@ApiTags('agent-workforce')
@ApiBearerAuth()
@Controller('agent-workforce')
export class AgentWorkforceController {
  constructor(
    private readonly service: AgentWorkforceService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('dispatch')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Governed agent task dispatched.' })
  dispatch(@Body() dto: DispatchAgentTaskDto) {
    const organizationId = this.tenantContext.getOrThrow();
    const executionBudget =
      dto.maxDurationMs !== undefined ||
      dto.maxTokens !== undefined ||
      dto.maxCostMinorUnits !== undefined
        ? {
            ...(dto.maxDurationMs !== undefined ? { maxDurationMs: dto.maxDurationMs } : {}),
            ...(dto.maxTokens !== undefined ? { maxTokens: dto.maxTokens } : {}),
            ...(dto.maxCostMinorUnits !== undefined
              ? { maxCostMinorUnits: dto.maxCostMinorUnits }
              : {}),
          }
        : undefined;

    return this.service.dispatch({
      organizationId,
      workflowRunId: dto.workflowRunId,
      workflowStepRunId: dto.workflowStepRunId,
      capabilityCode: dto.capabilityCode,
      prompt: dto.prompt,
      assuranceLevel: dto.assuranceLevel,
      correlationId: dto.correlationId,
      executionBudget,
    });
  }
}
