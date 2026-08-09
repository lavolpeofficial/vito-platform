import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourceExtractionService } from './source-extraction.service';
import { SourceVaultController } from './source-vault.controller';
import { SourceVaultService } from './source-vault.service';
import { LocalObjectStorageAdapter } from './storage/local-object-storage.adapter';
import { ObjectStoragePort } from './storage/object-storage.port';

@Module({
  imports: [AuditModule],
  controllers: [SourceVaultController],
  providers: [
    SourceVaultService,
    SourceExtractionService,
    LocalObjectStorageAdapter,
    { provide: ObjectStoragePort, useExisting: LocalObjectStorageAdapter },
  ],
  exports: [SourceVaultService, SourceExtractionService, ObjectStoragePort],
})
export class SourceVaultModule {}
