import { Module } from '@nestjs/common';
import { CapabilityDiscoveryController } from './capability-discovery.controller';
import { CapabilityDiscoveryService } from './capability-discovery.service';

@Module({
  controllers: [CapabilityDiscoveryController],
  providers: [CapabilityDiscoveryService],
  exports: [CapabilityDiscoveryService],
})
export class CapabilityDiscoveryModule {}
