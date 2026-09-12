import { Module } from '@nestjs/common';
import { ProviderIntelligenceController } from './provider-intelligence.controller';
import { ProviderIntelligenceService } from './provider-intelligence.service';

@Module({
  controllers: [ProviderIntelligenceController],
  providers: [ProviderIntelligenceService],
  exports: [ProviderIntelligenceService],
})
export class ProviderIntelligenceModule {}
