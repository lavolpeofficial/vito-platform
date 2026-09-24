import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user.interface';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { MachineScope, VITO_BRIDGE_MACHINE_SCOPE } from '../../common/decorators/machine-scope.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ConsumeCodeBuildApprovalDto, CreateCodeBuildApprovalDto } from './dto/code-build-approval.dto';
import { CodeBuildApprovalService } from './code-build-approval.service';

@ApiTags('engineering-release')
@ApiBearerAuth()
@Controller('engineering-release/code-build-approvals')
export class CodeBuildApprovalController {
  constructor(private readonly approvals: CodeBuildApprovalService) {}

  @Get('mission/:missionId/status')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  status(@CurrentUser() user: AuthenticatedUser, @Param('missionId') missionId: string) {
    return this.approvals.workflowDispatchStatus(user.organizationId, missionId);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCodeBuildApprovalDto) {
    return this.approvals.create(user.organizationId, user.userId, user.role, dto);
  }

  @Post(':id/revoke')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.revoke(user.organizationId, user.userId, id);
  }

  @Post(':id/consume')
  @MachineScope(VITO_BRIDGE_MACHINE_SCOPE)
  consume(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsumeCodeBuildApprovalDto) {
    return this.approvals.consume(user.organizationId, user.userId, id, dto);
  }
}
