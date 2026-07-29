import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/**
 * Rollenmodell für Tasks (siehe Sprint-2-Anforderung 6): OWNER, ADMIN und
 * MEMBER dürfen Tasks lesen und bearbeiten; VIEWER darf ausschließlich
 * lesen (GET-Endpunkte bleiben daher ohne @Roles(...), da sie für jede
 * authentifizierte Rolle offen sind).
 */
const TASK_WRITE_ROLES = [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER] as const;

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post()
  @Roles(...TASK_WRITE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Task wurde angelegt.' })
  async create(@Body() dto: CreateTaskDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.tasksService.create(organizationId, dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Liste der Tasks der Organization.' })
  async findAll() {
    const organizationId = this.tenantContext.getOrThrow();
    return this.tasksService.findAll(organizationId);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Task gefunden.' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.tasksService.findByIdOrFail(organizationId, id);
  }

  @Patch(':id')
  @Roles(...TASK_WRITE_ROLES)
  @ApiOkResponse({ description: 'Task wurde aktualisiert.' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.tasksService.update(organizationId, id, dto);
  }

  @Post(':id/complete')
  @Roles(...TASK_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Task wurde als abgeschlossen markiert.' })
  async complete(@Param('id', ParseUUIDPipe) id: string) {
    const organizationId = this.tenantContext.getOrThrow();
    return this.tasksService.complete(organizationId, id);
  }
}
