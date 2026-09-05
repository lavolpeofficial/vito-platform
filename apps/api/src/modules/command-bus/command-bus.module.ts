import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ServerCredentialsModule } from '../server-credentials/server-credentials.module';
import { CommandBusController } from './command-bus.controller';
import { CommandBusService } from './command-bus.service';
import { WorldGateResultAdapter } from './world-gate-result.adapter';
import { WorldGitHubClient } from './world-github.client';
import { WorldRunGateAdapter } from './world-run-gate.adapter';
import { WorldStatusAdapter } from './world-status.adapter';

@Module({
  imports: [AuditModule, ServerCredentialsModule],
  controllers: [CommandBusController],
  providers: [
    CommandBusService,
    WorldGitHubClient,
    WorldStatusAdapter,
    WorldRunGateAdapter,
    WorldGateResultAdapter,
  ],
  exports: [CommandBusService],
})
export class CommandBusModule implements OnModuleInit {
  constructor(
    private readonly bus: CommandBusService,
    private readonly worldStatus: WorldStatusAdapter,
    private readonly worldRunGate: WorldRunGateAdapter,
    private readonly worldGateResult: WorldGateResultAdapter,
  ) {}

  onModuleInit(): void {
    this.bus.register(this.worldStatus);
    this.bus.register(this.worldRunGate);
    this.bus.register(this.worldGateResult);
  }
}
