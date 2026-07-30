import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AssignWorkforceDto } from './dto/assign-workforce.dto';
import { CreateDigitalEmployeeDto } from './dto/create-digital-employee.dto';
import { UpdateDigitalEmployeeDto } from './dto/update-digital-employee.dto';
import { DigitalEmployeesService } from './digital-employees.service';

@ApiTags('digital-employees')
@ApiBearerAuth()
@Controller('digital-employees')
export class DigitalEmployeesController {
  constructor(
    private readonly digitalEmployeesService: DigitalEmployeesService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'DigitalEmployee wurde angelegt.' })
  async create(@Body() dto: CreateDigitalEmployeeDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.digitalEmployeesService.create(organizationId, dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Liste der DigitalEmployees der Organization.' })
  async findAll() {
    const organizationId = this.tenantContext.getOrThrow();
    return this.digitalEmployeesService.findAll(organizationId);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'DigitalEmployee gefunden.' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.digitalEmployeesService.findByIdOrFail(organizationId, id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'DigitalEmployee wurde aktualisiert.' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDigitalEmployeeDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.digitalEmployeesService.update(organizationId, id, dto);
  }

  @Patch(':id/workforce')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Workforce-Zuordnung des DigitalEmployee wurde aktualisiert.' })
  async assignWorkforce(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignWorkforceDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.digitalEmployeesService.assignWorkforce(organizationId, id, dto);
  }
}
