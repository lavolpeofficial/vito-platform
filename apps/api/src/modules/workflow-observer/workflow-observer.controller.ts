import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowObserverService } from './workflow-observer.service';

@ApiTags('workflow-observer')
@ApiBearerAuth()
@Controller('workflow-observer')
export class WorkflowObserverController {
  constructor(
    private readonly service: WorkflowObserverService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get(':workflowRunId')
  @ApiOkResponse({
    description:
      'Returns a tenant-scoped, read-only workflow snapshot and bounded audit timeline. It does not execute, resume, approve, or mutate the workflow.',
  })
  observe(@Param('workflowRunId') workflowRunId: string) {
    return this.service.observe(this.tenantContext.getOrThrow(), workflowRunId);
  }
}
