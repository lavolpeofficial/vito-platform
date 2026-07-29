import { Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CapabilitiesService } from './capabilities.service';
import { GrantCapabilityDto } from './dto/grant-capability.dto';

@ApiTags('digital-employees')
@ApiBearerAuth()
@Roles(UserRole.OWNER, UserRole.ADMIN)
@Controller('digital-employees/:id/capabilities')
export class DigitalEmployeeCapabilitiesController {
  constructor(
    private readonly capabilitiesService: CapabilitiesService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post(':capabilityId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOkResponse({ description: 'Capability wurde dem DigitalEmployee zugewiesen (grant).' })
  async grant(
    @Param('id', ParseUUIDPipe) digitalEmployeeId: string,
    @Param('capabilityId', ParseUUIDPipe) capabilityId: string,
    @Body() dto: GrantCapabilityDto,
  ) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.capabilitiesService.grantToDigitalEmployee(organizationId, digitalEmployeeId, capabilityId, dto);
  }

  @Delete(':capabilityId')
  @ApiOkResponse({ description: 'Capability wurde vom DigitalEmployee entzogen (revoke).' })
  async revoke(
    @Param('id', ParseUUIDPipe) digitalEmployeeId: string,
    @Param('capabilityId', ParseUUIDPipe) capabilityId: string,
  ) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.capabilitiesService.revokeFromDigitalEmployee(organizationId, digitalEmployeeId, capabilityId);
  }
}
