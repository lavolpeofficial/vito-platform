import { Module } from '@nestjs/common';

import { GovernedRuntimeModule } from '../governed-runtime/governed-runtime.module';
import { ProviderRegistryModule } from '../provider-registry/provider-registry.module';
import { CloudGovernedExecutionModule } from '../cloud-governed-execution/cloud-governed-execution.module';
import { AgentWorkforceController } from './agent-workforce.controller';
import { AgentWorkforceService } from './agent-workforce.service';

@Module({
  imports: [
    ProviderRegistryModule,
    GovernedRuntimeModule,
    CloudGovernedExecutionModule,
  ],
  controllers: [AgentWorkforceController],
  providers: [AgentWorkforceService],
  exports: [AgentWorkforceService],
})
export class AgentWorkforceModule {}
