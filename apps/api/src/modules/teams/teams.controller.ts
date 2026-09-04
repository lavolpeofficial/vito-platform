import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamsService } from './teams.service';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Team wurde angelegt.' })
  create(@Body() dto: CreateTeamDto) {
    return this.teamsService.create(this.tenantContext.getOrThrow(), dto);
  }

  @Get()
  @ApiQuery({ name: 'departmentId', required: false, description: 'Optionale Department-UUID.' })
  @ApiOkResponse({ description: 'Teams der Organization, optional nach Department gefiltert.' })
  findAll(@Query('departmentId') departmentId?: string) {
    return this.teamsService.findAll(this.tenantContext.getOrThrow(), departmentId);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Team gefunden.' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.teamsService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Team wurde aktualisiert.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return this.teamsService.update(this.tenantContext.getOrThrow(), id, dto);
  }
}
