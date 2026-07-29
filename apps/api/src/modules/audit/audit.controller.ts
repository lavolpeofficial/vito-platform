import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from './audit.service';

@ApiTags('audit-events')
@ApiBearerAuth()
@Controller('audit-events')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Liste aller AuditEvents der Organization, neueste zuerst.' })
  async list() {
    const organizationId = this.tenantContext.getOrThrow();
    return this.auditService.listForOrganization(organizationId);
  }
}
