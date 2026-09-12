import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowRuntimeController } from './workflow-runtime.controller';
import { WorkflowRuntimeService } from './workflow-runtime.service';

@Module({
  imports: [AuditModule],
  controllers: [WorkflowRuntimeController],
  providers: [WorkflowRuntimeService],
  exports: [WorkflowRuntimeService],
})
export class WorkflowRuntimeModule {}
