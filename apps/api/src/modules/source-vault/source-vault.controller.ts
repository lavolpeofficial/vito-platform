import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { LinkKnowledgeSourceDto } from './dto/link-knowledge-source.dto';
import { RegisterSourceDto } from './dto/register-source.dto';
import { SourceVaultService } from './source-vault.service';

@ApiTags('source-vault')
@ApiBearerAuth()
@Controller('source-vault')
export class SourceVaultController {
  constructor(
    private readonly sourceVaultService: SourceVaultService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('sources')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Source-Metadaten registriert oder vorhandenes exaktes Duplikat zurückgegeben.' })
  async register(@Body() dto: RegisterSourceDto) {
    return this.sourceVaultService.register(this.tenantContext.getOrThrow(), dto);
  }

  @Get('sources')
  @ApiOkResponse({ description: 'Sources der aktuellen Organization.' })
  async findAll() {
    return this.sourceVaultService.findAll(this.tenantContext.getOrThrow());
  }

  @Get('sources/:id')
  @ApiOkResponse({ description: 'Source inklusive Provenance-Verknüpfungen und direkter Versionsbeziehungen.' })
  async findOne(@Param('id') id: string) {
    return this.sourceVaultService.findByIdOrFail(this.tenantContext.getOrThrow(), id);
  }

  @Get('sources/:id/lineage')
  @ApiOkResponse({ description: 'Versionslinie der Source.' })
  async lineage(@Param('id') id: string) {
    return this.sourceVaultService.lineage(this.tenantContext.getOrThrow(), id);
  }

  @Get('duplicates/:sha256')
  @ApiOkResponse({ description: 'Prüft innerhalb des Tenants auf ein exaktes SHA-256-Duplikat.' })
  async duplicate(@Param('sha256') sha256: string) {
    return this.sourceVaultService.findDuplicate(this.tenantContext.getOrThrow(), sha256);
  }

  @Post('sources/:id/knowledge-links')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Knowledge-Source-Provenance-Verknüpfung angelegt.' })
  async linkKnowledge(@Param('id') id: string, @Body() dto: LinkKnowledgeSourceDto) {
    return this.sourceVaultService.linkKnowledge(this.tenantContext.getOrThrow(), id, dto);
  }
}
