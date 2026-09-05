import { Body, Controller, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CommandBusService } from './command-bus.service';
import { DispatchCommandDto } from './dto/dispatch-command.dto';

@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER, UserRole.VIEWER)
@Controller('commands')
export class CommandBusController {
  constructor(
    private readonly commandBus: CommandBusService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('dispatch')
  dispatch(@Body() request: DispatchCommandDto) {
    return this.commandBus.dispatchRequest(request, {
      organizationId: this.tenantContext.getOrThrow(),
      userId: this.tenantContext.getUserId(),
      role: this.tenantContext.getRole(),
      authenticationMethod: this.tenantContext.getAuthenticationMethod(),
    });
  }
}
