import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AoeImportService } from './aoe-import.service';

@Module({
  imports: [AuditModule],
  providers: [AoeImportService],
  exports: [AoeImportService],
})
export class AoeImportModule {}
