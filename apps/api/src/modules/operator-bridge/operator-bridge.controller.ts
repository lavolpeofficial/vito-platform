import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  MachineScope,
  VITO_BRIDGE_MACHINE_SCOPE,
} from '../../common/decorators/machine-scope.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import {
  OperatorTaskResultDto,
  SubmitOperatorTaskResponseDto,
} from './dto/operator-task-response.dto';
import { SubmitOperatorTaskDto } from './dto/submit-operator-task.dto';
import { OperatorBridgeService } from './operator-bridge.service';

@ApiTags('operator')
@ApiBearerAuth()
@Controller('v1/operator/tasks')
export class OperatorBridgeController {
  constructor(
    private readonly service: OperatorBridgeService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @MachineScope(VITO_BRIDGE_MACHINE_SCOPE)
  @Roles(UserRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Governed operator task accepted or resolved idempotently.',
    type: SubmitOperatorTaskResponseDto,
  })
  submit(@Body() dto: SubmitOperatorTaskDto) {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (!userId) throw new UnauthorizedException('JWT-backed identity required.');
    return this.service.submitTask(organizationId, userId, dto);
  }

  @Get(':taskId')
  @MachineScope(VITO_BRIDGE_MACHINE_SCOPE)
  @Roles(UserRole.MEMBER)
  @ApiOkResponse({ description: 'Tenant-scoped operator task result.', type: OperatorTaskResultDto })
  get(@Param('taskId', ParseUUIDPipe) taskId: string) {
    return this.service.getTask(this.tenantContext.getOrThrow(), taskId);
  }
}
