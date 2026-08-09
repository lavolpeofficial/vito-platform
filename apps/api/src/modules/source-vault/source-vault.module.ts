import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SourceExtractionController } from './source-extraction.controller';
import { SourceExtractionService } from './source-extraction.service';
import { SourceVaultController } from './source-vault.controller';
import { SourceVaultService } from './source-vault.service';
import { LocalObjectStorageAdapter } from './storage/local-object-storage.adapter';
import { ObjectStoragePort } from './storage/object-storage.port';
import { S3ObjectStorageAdapter } from './storage/s3-object-storage.adapter';

@Module({
  imports: [AuditModule],
  controllers: [SourceVaultController, SourceExtractionController],
  providers: [
    SourceVaultService,
    SourceExtractionService,
    LocalObjectStorageAdapter,
    S3ObjectStorageAdapter,
    {
      provide: ObjectStoragePort,
      inject: [LocalObjectStorageAdapter, S3ObjectStorageAdapter],
      useFactory: (local: LocalObjectStorageAdapter, s3: S3ObjectStorageAdapter): ObjectStoragePort => {
        const configured = process.env.SOURCE_VAULT_STORAGE_DRIVER?.toLowerCase();
        const driver = configured ?? (process.env.NODE_ENV === 'production' ? undefined : 'local');

        if (!driver) {
          throw new Error('In Produktion muss SOURCE_VAULT_STORAGE_DRIVER explizit gesetzt werden.');
        }
        if (driver === 'local') {
          if (process.env.NODE_ENV === 'production') {
            throw new Error('SOURCE_VAULT_STORAGE_DRIVER=local ist in Produktion nicht erlaubt.');
          }
          return local;
        }
        if (driver === 's3') return s3;
        throw new Error(`Unbekannter SOURCE_VAULT_STORAGE_DRIVER: ${driver}`);
      },
    },
  ],
  exports: [SourceVaultService, SourceExtractionService, ObjectStoragePort],
})
export class SourceVaultModule {}
