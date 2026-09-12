import { BadRequestException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowVerificationService, type WorkflowVerificationStatus } from './workflow-verification.service';

const VERIFICATION_STATUSES: readonly WorkflowVerificationStatus[] = ['VERIFIED', 'FAILED', 'INCONCLUSIVE', 'BLOCKED'];

@ApiTags('workflow-verification')
@ApiBearerAuth()
@Controller('workflow-verification')
export class WorkflowVerificationController {
  constructor(
    private readonly service: WorkflowVerificationService,
    private readonly tenantContext: TenantContext,
  ) {}

  @Get(':workflowRunId')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Lists persisted tenant-scoped verification evidence for one workflow run.' })
  listForRun(
    @Param('workflowRunId') workflowRunId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listForRun(
      this.tenantContext.getOrThrow(),
      requireId(workflowRunId, 'workflowRunId'),
      {
        ...(status == null ? {} : { status: parseStatus(status) }),
        ...(limit == null ? {} : { limit: parseLimit(limit) }),
      },
    );
  }

  @Post(':workflowRunId/steps/:workflowStepRunId')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @ApiOkResponse({ description: 'Records an objective, evidence-backed verification classification for a persisted workflow step.' })
  verify(
    @Param('workflowRunId') workflowRunId: string,
    @Param('workflowStepRunId') workflowStepRunId: string,
  ) {
    return this.service.verifyStep(this.tenantContext.getOrThrow(), workflowRunId, workflowStepRunId);
  }
}

export function parseStatus(input: string): WorkflowVerificationStatus {
  const normalized = input.trim();
  if (!VERIFICATION_STATUSES.includes(normalized as WorkflowVerificationStatus)) {
    throw new BadRequestException(`unsupported verification status: ${normalized || '(empty)'}`);
  }
  return normalized as WorkflowVerificationStatus;
}

export function parseLimit(input: string): number {
  if (!/^\d+$/.test(input.trim())) throw new BadRequestException('limit must be an integer between 1 and 200.');
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new BadRequestException('limit must be an integer between 1 and 200.');
  }
  return value;
}

function requireId(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new BadRequestException(`${field} is required.`);
  return normalized;
}
