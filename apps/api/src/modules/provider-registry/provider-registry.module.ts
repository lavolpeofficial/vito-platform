import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CloudGovernedExecutionModule } from '../cloud-governed-execution/cloud-governed-execution.module';
import { GovernedRuntimeModule } from '../governed-runtime/governed-runtime.module';
import { EngineeringProviderProvisioningService } from './engineering-provider-provisioning.service';
import { ProviderRegistryController } from './provider-registry.controller';
import { ProviderRegistryService } from './provider-registry.service';
import { ProviderRouterService } from './provider-router.service';
import { ProviderReadinessProbeService } from './provider-readiness-probe.service';
import { ProviderRuntimeStateService } from './provider-runtime-state.service';

@Module({
  imports:[AuditModule,CloudGovernedExecutionModule,GovernedRuntimeModule],
  controllers:[ProviderRegistryController],
  providers:[ProviderRegistryService,ProviderRouterService,EngineeringProviderProvisioningService,ProviderRuntimeStateService,ProviderReadinessProbeService],
  exports:[ProviderRegistryService,ProviderRouterService,EngineeringProviderProvisioningService,ProviderRuntimeStateService,ProviderReadinessProbeService],
})
export class ProviderRegistryModule {}
