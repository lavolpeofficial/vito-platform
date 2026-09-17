import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CodeBuildApprovalController } from './code-build-approval.controller';
import { CodeBuildApprovalService } from './code-build-approval.service';

@Module({ imports: [AuditModule], controllers: [CodeBuildApprovalController], providers: [CodeBuildApprovalService], exports: [CodeBuildApprovalService] })
export class EngineeringReleaseModule {}
