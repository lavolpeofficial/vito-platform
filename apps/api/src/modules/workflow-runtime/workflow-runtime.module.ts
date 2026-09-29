import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { HumanDecisionCorrectionService } from './human-decision-correction.service';
import { HumanReleaseApprovalService } from './human-release-approval.service';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { ExecutionCancellationModule } from '../execution-cancellation/execution-cancellation.module';

@Module({
  imports: [AuditModule, ExecutionCancellationModule],
  controllers: [WorkflowRuntimeController],
  providers: [WorkflowRuntimeService, HumanDecisionCorrectionService, HumanReleaseApprovalService],
  exports: [WorkflowRuntimeService, HumanDecisionCorrectionService, HumanReleaseApprovalService],
})
export class WorkflowRuntimeModule {}
