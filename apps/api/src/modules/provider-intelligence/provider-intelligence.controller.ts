import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ProviderIntelligenceService } from './provider-intelligence.service';

@ApiTags('provider-intelligence')
@ApiBearerAuth()
@Controller('provider-intelligence')
export class ProviderIntelligenceController {
  constructor(
    private readonly service: ProviderIntelligenceService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get()
  @ApiOkResponse({
    description:
      'Returns a tenant-scoped, read-only provider readiness, capability coverage, routing and cost-visibility snapshot.',
  })
  snapshot() {
    return this.service.snapshot(this.tenantContext.getOrThrow());
  }
}
