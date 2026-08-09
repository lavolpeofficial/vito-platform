import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourceVaultController } from './source-vault.controller';
import { SourceVaultService } from './source-vault.service';

@Module({
  imports: [AuditModule],
  controllers: [SourceVaultController],
  providers: [SourceVaultService],
  exports: [SourceVaultService],
})
export class SourceVaultModule {}
