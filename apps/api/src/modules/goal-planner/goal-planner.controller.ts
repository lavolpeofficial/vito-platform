import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreateGoalPlanDto } from './dto/create-goal-plan.dto';
import { GoalPlannerService } from './goal-planner.service';

@ApiTags('goal-planner')
@ApiBearerAuth()
@Controller('goal-plans')
export class GoalPlannerController {
  constructor(
    private readonly service: GoalPlannerService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('engineering')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Creates a non-executable, governed engineering plan grounded in server-owned workflow capabilities.' })
  createEngineeringPlan(@Body() dto: CreateGoalPlanDto) {
    return this.service.planEngineeringGoal(
      this.tenantContext.getOrThrow(),
      dto.goal,
      dto.assuranceLevel ?? 'AL3',
    );
  }
}
