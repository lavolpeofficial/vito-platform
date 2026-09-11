import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CapabilityDiscoveryService } from './capability-discovery.service';

@ApiTags('capability-discovery')
@ApiBearerAuth()
@Controller('capability-discovery')
export class CapabilityDiscoveryController {
  constructor(private readonly service: CapabilityDiscoveryService, private readonly tenantContext: TenantContext) {}

  @Get(':code')
  @ApiOkResponse({ description: 'Assesses whether a capability is executable, merely registered, candidate-only, or missing.' })
  assess(@Param('code') code: string) {
    return this.service.assess(this.tenantContext.getOrThrow(), code);
  }
}
