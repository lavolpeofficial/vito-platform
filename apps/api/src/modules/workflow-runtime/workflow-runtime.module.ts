import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { HumanReleaseApprovalService } from './human-release-approval.service';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';
import { ExecutionCancellationModule } from '../execution-cancellation/execution-cancellation.module';

@Module({
  imports: [AuditModule, ExecutionCancellationModule],
  controllers: [WorkflowRuntimeController],
  providers: [WorkflowRuntimeService, HumanReleaseApprovalService],
  exports: [WorkflowRuntimeService, HumanReleaseApprovalService],
})
export class WorkflowRuntimeModule {}
