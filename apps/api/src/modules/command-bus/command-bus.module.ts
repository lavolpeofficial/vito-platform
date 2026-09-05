import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CommandBusController } from './command-bus.controller';
import { CommandBusService } from './command-bus.service';
import { WorldStatusAdapter } from './world-status.adapter';

@Module({
  imports: [AuditModule],
  controllers: [CommandBusController],
  providers: [CommandBusService, WorldStatusAdapter],
  exports: [CommandBusService],
})
export class CommandBusModule implements OnModuleInit {
  constructor(private readonly bus: CommandBusService, private readonly worldStatus: WorldStatusAdapter) {}
  onModuleInit(): void {
    this.bus.register(this.worldStatus);
  }
}
