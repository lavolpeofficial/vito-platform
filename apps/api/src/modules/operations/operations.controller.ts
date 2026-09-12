import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OperationsService } from './operations.service';

@ApiTags('operations')
@ApiBearerAuth()
@Controller('operations')
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class OperationsController {
  constructor(
    private readonly service: OperationsService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get('summary')
  @ApiOkResponse({
    description:
      'Returns a tenant-scoped read-only VITO operational summary. It provides telemetry only and grants no execution authority.',
  })
  summary() {
    return this.service.summary(this.tenantContext.getOrThrow());
  }
}
