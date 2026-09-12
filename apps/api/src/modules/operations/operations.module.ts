import { Module } from '@nestjs/common';
import { ProviderIntelligenceModule } from '../provider-intelligence/provider-intelligence.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [ProviderIntelligenceModule],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
