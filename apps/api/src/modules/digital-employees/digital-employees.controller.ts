import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ActivateDigitalEmployeeDto } from './dto/activate-digital-employee.dto';
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
    return this.digitalEmployeesService.create(this.tenantContext.getOrThrow(), dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Liste der DigitalEmployees der Organization.' })
  async findAll() {
    return this.digitalEmployeesService.findAll(this.tenantContext.getOrThrow());
  }

  @Get(':id')
  @ApiOkResponse({ description: 'DigitalEmployee gefunden.' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.digitalEmployeesService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'DigitalEmployee wurde aktualisiert. ACTIVE ist über diesen Endpoint gesperrt.' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDigitalEmployeeDto) {
    return this.digitalEmployeesService.update(this.tenantContext.getOrThrow(), id, dto);
  }

  @Patch(':id/workforce')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Workforce-Zuordnung des DigitalEmployee wurde aktualisiert.' })
  async assignWorkforce(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignWorkforceDto) {
    return this.digitalEmployeesService.assignWorkforce(this.tenantContext.getOrThrow(), id, dto);
  }

  @Post(':id/activate')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'DigitalEmployee wurde nach bestandenem Activation Gate aktiviert.' })
  async activate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActivateDigitalEmployeeDto) {
    return this.digitalEmployeesService.activate(this.tenantContext.getOrThrow(), id, dto);
  }
}
