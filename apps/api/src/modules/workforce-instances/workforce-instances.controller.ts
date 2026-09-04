import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreateWorkforceInstanceDto } from './dto/create-workforce-instance.dto';
import { UpdateWorkforceInstanceDto } from './dto/update-workforce-instance.dto';
import { WorkforceInstancesService } from './workforce-instances.service';

@ApiTags('workforce-instances')
@ApiBearerAuth()
@Controller('workforce-instances')
export class WorkforceInstancesController {
  constructor(
    private readonly workforceInstancesService: WorkforceInstancesService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'WorkforceInstance wurde angelegt.' })
  create(@Body() dto: CreateWorkforceInstanceDto) {
    return this.workforceInstancesService.create(this.tenantContext.getOrThrow(), dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Liste der WorkforceInstances der Organization.' })
  findAll() {
    return this.workforceInstancesService.findAll(this.tenantContext.getOrThrow());
  }

  @Get(':id')
  @ApiOkResponse({ description: 'WorkforceInstance gefunden.' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.workforceInstancesService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'WorkforceInstance wurde aktualisiert.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWorkforceInstanceDto) {
    return this.workforceInstancesService.update(this.tenantContext.getOrThrow(), id, dto);
  }
}
