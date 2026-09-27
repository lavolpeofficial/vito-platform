import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OperatorBridgeMachineIdentityService } from './operator-bridge-machine-identity.service';

@ApiTags('operator')
@ApiBearerAuth()
@Controller('v1/operator/machine-identity')
export class OperatorBridgeMachineIdentityController {
  constructor(
    private readonly service: OperatorBridgeMachineIdentityService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('provision')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Human-governed idempotent provisioning of the least-privilege VITO bridge machine identity.',
  })
  provision(@CurrentUser() user: AuthenticatedUser) {
    return this.service.provision(this.tenantContext.getOrThrow(), user);
  }
}
