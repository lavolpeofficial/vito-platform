import { Module } from '@nestjs/common';

import { GovernedRuntimeModule } from '../governed-runtime/governed-runtime.module';
import { ProviderRegistryModule } from '../provider-registry/provider-registry.module';
import { AgentWorkforceService } from './agent-workforce.service';

@Module({
  imports: [ProviderRegistryModule, GovernedRuntimeModule],
  providers: [AgentWorkforceService],
  exports: [AgentWorkforceService],
})
export class AgentWorkforceModule {}
