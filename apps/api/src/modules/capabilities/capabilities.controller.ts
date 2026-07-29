import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CapabilitiesService } from './capabilities.service';
import { CreateCapabilityDto } from './dto/create-capability.dto';

@ApiTags('capabilities')
@ApiBearerAuth()
@Controller('capabilities')
export class CapabilitiesController {
  constructor(
    private readonly capabilitiesService: CapabilitiesService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Capability wurde angelegt.' })
  async create(@Body() dto: CreateCapabilityDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.capabilitiesService.create(organizationId, dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Liste der Capabilities der Organization.' })
  async findAll() {
    const organizationId = this.tenantContext.getOrThrow();
    return this.capabilitiesService.findAll(organizationId);
  }
}
