import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreateOrganizationRoleDto } from './dto/create-organization-role.dto';
import { UpdateOrganizationRoleDto } from './dto/update-organization-role.dto';
import { OrganizationRolesService } from './organization-roles.service';

@ApiTags('organization-roles')
@ApiBearerAuth()
@Controller('organization-roles')
export class OrganizationRolesController {
  constructor(
    private readonly organizationRolesService: OrganizationRolesService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Organization Role wurde angelegt.' })
  create(@Body() dto: CreateOrganizationRoleDto) {
    return this.organizationRolesService.create(this.tenantContext.getOrThrow(), dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Organization Roles der aktuellen Organization.' })
  findAll() {
    return this.organizationRolesService.findAll(this.tenantContext.getOrThrow());
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Organization Role gefunden.' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationRolesService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Organization Role wurde aktualisiert.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrganizationRoleDto) {
    return this.organizationRolesService.update(this.tenantContext.getOrThrow(), id, dto);
  }
}
