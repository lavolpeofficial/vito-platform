import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly departmentsService: DepartmentsService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Department wurde angelegt.' })
  create(@Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(this.tenantContext.getOrThrow(), dto);
  }

  @Get()
  @ApiQuery({ name: 'workforceInstanceId', required: false, type: String, description: 'Optionaler UUID-Filter für eine WorkforceInstance.' })
  @ApiOkResponse({ description: 'Departments der Organization, optional nach Workforce gefiltert.' })
  findAll(@Query('workforceInstanceId') workforceInstanceId?: string) {
    return this.departmentsService.findAll(this.tenantContext.getOrThrow(), workforceInstanceId);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Department gefunden.' })
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.departmentsService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Department wurde aktualisiert.' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(this.tenantContext.getOrThrow(), id, dto);
  }
}
