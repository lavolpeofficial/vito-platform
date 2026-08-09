import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { LinkKnowledgeSourceDto } from './dto/link-knowledge-source.dto';
import { RegisterSourceDto } from './dto/register-source.dto';
import { UploadSourceDto } from './dto/upload-source.dto';
import { SourceVaultService, UploadedSourceFile } from './source-vault.service';

const MAX_UPLOAD_BYTES = Number(process.env.SOURCE_VAULT_MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

@ApiTags('source-vault')
@ApiBearerAuth()
@Controller('source-vault')
export class SourceVaultController {
  constructor(
    private readonly sourceVaultService: SourceVaultService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('upload')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'sourceType', 'ingestedBy'],
      properties: {
        file: { type: 'string', format: 'binary' },
        sourceType: { type: 'string', example: 'SPREADSHEET' },
        ingestedBy: { type: 'string', example: 'user:alessandro' },
        projectKey: { type: 'string', example: 'KI-CONSULTANT' },
        domain: { type: 'string', example: 'consulting' },
        language: { type: 'string', example: 'de' },
        title: { type: 'string' },
        author: { type: 'string' },
        sourceDate: { type: 'string', format: 'date-time' },
        confidentiality: { type: 'string', example: 'INTERNAL' },
        rightsStatus: { type: 'string', example: 'LICENSED' },
        retentionClass: { type: 'string' },
        supersedesSourceId: { type: 'string' },
        parentSourceId: { type: 'string' },
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Original gespeichert, gehasht und als Source registriert; Duplikate werden ohne zweite Speicherung zurückgegeben.' })
  async upload(@UploadedFile() file: UploadedSourceFile | undefined, @Body() dto: UploadSourceDto) {
    if (!file) throw new BadRequestException('Multipart-Feld "file" fehlt.');
    if (!file.buffer || file.size <= 0) throw new BadRequestException('Leere Dateien werden nicht in SOURCE VAULT aufgenommen.');
    return this.sourceVaultService.ingestUpload(this.tenantContext.getOrThrow(), file, dto);
  }

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

  @Get('sources/:id/content')
  @ApiOkResponse({ description: 'Liefert das Original nach erneuter SHA-256-Integritätsprüfung.' })
  async content(@Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const { source, buffer } = await this.sourceVaultService.getContent(this.tenantContext.getOrThrow(), id);
    response.setHeader('Content-Type', source.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(source.originalFilename)}`);
    response.setHeader('X-Source-Id', source.sourceId);
    response.setHeader('X-Content-SHA256', source.sha256);
    return new StreamableFile(buffer);
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
