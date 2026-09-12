import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { KnowledgeHarvestDispatcherService } from './knowledge-harvest-dispatcher.service';
import { KnowledgeHarvesterService } from './knowledge-harvester.service';

@ApiTags('knowledge-harvester')
@ApiBearerAuth()
@Controller('knowledge')
export class KnowledgeHarvesterController {
  constructor(
    private readonly service: KnowledgeHarvesterService,
    private readonly dispatcher: KnowledgeHarvestDispatcherService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('sources/:sourceId/harvest')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Selects the governed harvester from persisted source metadata and ingests supported knowledge.' })
  harvest(@Param('sourceId') sourceId: string) {
    return this.dispatcher.harvestSource(this.tenantContext.getOrThrow(), sourceId);
  }

  @Post('sources/:sourceId/harvest-text')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Harvests bounded, source-backed text fragments with provenance.' })
  harvestText(@Param('sourceId') sourceId: string) {
    return this.service.harvestTextSource(this.tenantContext.getOrThrow(), sourceId);
  }

  @Post('sources/:sourceId/harvest-docx')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Harvests bounded DOCX main-document paragraphs with source provenance.' })
  harvestDocx(@Param('sourceId') sourceId: string) {
    return this.service.harvestDocxSource(this.tenantContext.getOrThrow(), sourceId);
  }

  @Post('sources/:sourceId/harvest-xlsx')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Harvests bounded XLSX row evidence with cell-range provenance; formulas are not evaluated.' })
  harvestXlsx(@Param('sourceId') sourceId: string) {
    return this.service.harvestXlsxSource(this.tenantContext.getOrThrow(), sourceId);
  }

  @Post('sources/:sourceId/harvest-pptx')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Harvests bounded PPTX slide text with slide provenance.' })
  harvestPptx(@Param('sourceId') sourceId: string) {
    return this.service.harvestPptxSource(this.tenantContext.getOrThrow(), sourceId);
  }

  @Get('search')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER, UserRole.VIEWER)
  @ApiOkResponse({ description: 'Tenant-scoped PostgreSQL full-text retrieval over harvested knowledge.' })
  search(@Query('q') query: string, @Query('limit') limit?: string) {
    const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10);
    return this.service.search(
      this.tenantContext.getOrThrow(),
      query ?? '',
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
  }
}
