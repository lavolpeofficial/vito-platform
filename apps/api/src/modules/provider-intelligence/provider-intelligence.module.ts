import { Module } from '@nestjs/common';
import { ProviderRegistryModule } from '../provider-registry/provider-registry.module';
import { ProviderIntelligenceController } from './provider-intelligence.controller';
import { ProviderIntelligenceService } from './provider-intelligence.service';

@Module({
  imports: [ProviderRegistryModule],
  controllers: [ProviderIntelligenceController],
  providers: [ProviderIntelligenceService],
  exports: [ProviderIntelligenceService],
})
export class ProviderIntelligenceModule {}
