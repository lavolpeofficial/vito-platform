import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EngineeringProviderProvisioningService } from './engineering-provider-provisioning.service';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderRouterService } from './provider-router.service';

@Module({
  imports: [AuditModule],
  providers: [
    ProviderRegistryService,
    ProviderRouterService,
    EngineeringProviderProvisioningService,
  ],
  exports: [
    ProviderRegistryService,
    ProviderRouterService,
    EngineeringProviderProvisioningService,
  ],
})
export class ProviderRegistryModule {}
