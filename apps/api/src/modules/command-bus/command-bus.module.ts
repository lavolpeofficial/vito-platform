import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommandBusController } from './command-bus.controller';
import { CommandBusService } from './command-bus.service';
import { WorldStatusAdapter } from './world-status.adapter';
import { WorldRunGateAdapter } from './world-run-gate.adapter';

@Module({
  imports: [AuditModule],
  controllers: [CommandBusController],
  providers: [CommandBusService, WorldStatusAdapter, WorldRunGateAdapter],
  exports: [CommandBusService],
})
export class CommandBusModule implements OnModuleInit {
  constructor(
    private readonly bus: CommandBusService,
    private readonly worldStatus: WorldStatusAdapter,
    private readonly worldRunGate: WorldRunGateAdapter,
  ) {}

  onModuleInit(): void {
    this.bus.register(this.worldStatus);
    this.bus.register(this.worldRunGate);
  }
}
