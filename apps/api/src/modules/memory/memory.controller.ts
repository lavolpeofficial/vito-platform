import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { CreateMemoryEntryDto } from './dto/create-memory-entry.dto';
import { MemoryService, type MemoryScope } from './memory.service';

@ApiTags('memory')
@ApiBearerAuth()
@Controller('memory')
export class MemoryController {
  constructor(private readonly service: MemoryService, private readonly tenantContext: TenantContext) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Records a tenant-scoped memory entry with explicit provenance.' })
  record(@Body() dto: CreateMemoryEntryDto) {
    return this.service.record(this.tenantContext.getOrThrow(), {
      kind: dto.kind,
      scope: dto.scope,
      scopeId: dto.scopeId ?? null,
      title: dto.title,
      content: dto.content,
      sourceType: dto.sourceType,
      sourceRef: dto.sourceRef ?? null,
      confidence: dto.confidence ?? null,
      metadata: dto.metadata ?? {},
    });
  }

  @Get('search')
  @ApiOkResponse({ description: 'Searches active memory entries inside the authenticated tenant.' })
  search(@Query('q') q: string, @Query('limit') limit?: string, @Query('scope') scope?: MemoryScope, @Query('scopeId') scopeId?: string) {
    const scopes = scope ? [{ scope, scopeId: scopeId ?? null }] : undefined;
    return this.service.search(this.tenantContext.getOrThrow(), q ?? '', limit ? Number(limit) : 8, scopes);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Retracts a memory entry without deleting its provenance.' })
  retract(@Param('id') id: string) {
    return this.service.retract(this.tenantContext.getOrThrow(), id);
  }
}
