import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkflowVerificationController } from './workflow-verification.controller';
import { WorkflowVerificationService } from './workflow-verification.service';

@Module({
  imports: [AuditModule],
  controllers: [WorkflowVerificationController],
  providers: [WorkflowVerificationService],
  exports: [WorkflowVerificationService],
})
export class WorkflowVerificationModule {}
