import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderRouterService } from './provider-router.service';

@Module({
  imports: [AuditModule],
  providers: [ProviderRegistryService, ProviderRouterService],
  exports: [ProviderRegistryService, ProviderRouterService],
})
export class ProviderRegistryModule {}
