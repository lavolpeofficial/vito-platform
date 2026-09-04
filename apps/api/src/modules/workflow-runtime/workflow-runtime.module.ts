import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@Module({
  imports: [AuditModule],
  providers: [WorkflowRuntimeService],
  exports: [WorkflowRuntimeService],
})
export class WorkflowRuntimeModule {}
