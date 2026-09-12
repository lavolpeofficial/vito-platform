import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { HumanReleaseApprovalService } from './human-release-approval.service';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@Module({
  imports: [AuditModule],
  controllers: [WorkflowRuntimeController],
  providers: [WorkflowRuntimeService, HumanReleaseApprovalService],
  exports: [WorkflowRuntimeService, HumanReleaseApprovalService],
})
export class WorkflowRuntimeModule {}
