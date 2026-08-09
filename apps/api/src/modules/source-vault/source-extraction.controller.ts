import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { SourceExtractionService } from './source-extraction.service';

@ApiTags('source-vault')
@ApiBearerAuth()
@Controller('source-vault')
export class SourceExtractionController {
  constructor(
    private readonly sourceExtractionService: SourceExtractionService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Post('sources/:id/extract/xlsx')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'Extrahiert Workbook-, Sheet- und Formelstruktur einer XLSX-Source.' })
  async extractXlsx(@Param('id') id: string) {
    return this.sourceExtractionService.extractXlsx(this.tenantContext.getOrThrow(), id);
  }
}
