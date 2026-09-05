import { Body, Controller, Post } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CommandBusService } from './command-bus.service';
import { DispatchCommandDto } from './dto/dispatch-command.dto';

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
