import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { PositionsService } from './positions.service';

@ApiTags('positions')
@ApiBearerAuth()
@Controller('positions')
export class PositionsController {
  constructor(
    private readonly positionsService: PositionsService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Position wurde angelegt.' })
  create(@Body() dto: CreatePositionDto) {
    return this.positionsService.create(this.tenantContext.getOrThrow(), dto);
  }

  @Get()
  @ApiQuery({
    name: 'workforceInstanceId',
    required: false,
    description: 'Optionale UUID der Workforce-Instanz.',
  })
  @ApiOkResponse({ description: 'Positionen der Organization, optional nach Workforce gefiltert.' })
  findAll(@Query('workforceInstanceId') workforceInstanceId?: string) {
    return this.positionsService.findAll(this.tenantContext.getOrThrow(), workforceInstanceId);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Position gefunden.' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.positionsService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Position wurde aktualisiert.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePositionDto) {
    return this.positionsService.update(this.tenantContext.getOrThrow(), id, dto);
  }
}
