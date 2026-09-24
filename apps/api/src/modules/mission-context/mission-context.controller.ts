import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { TenantContext } from '../../common/tenant/tenant-context';
import { MissionContextService } from './mission-context.service';

@ApiTags('mission-context')
@ApiBearerAuth()
@Controller('mission-context')
export class MissionContextController {
  constructor(
    private readonly service: MissionContextService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get(':workflowRunId')
  @ApiOkResponse({ description: 'Returns a tenant-scoped mission context projection. Context is advisory and never grants execution authority.' })
  snapshot(@Param('workflowRunId') workflowRunId: string) {
    return this.service.snapshot(this.tenantContext.getOrThrow(), workflowRunId);
  }
}
