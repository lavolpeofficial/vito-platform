import { Module } from '@nestjs/common';
import { AgentWorkforceModule } from '../agent-workforce/agent-workforce.module';
import { AuditModule } from '../audit/audit.module';
import {
  OPERATOR_BRIDGE_CONFIG,
  loadOperatorBridgeConfig,
} from './operator-bridge.config';
import { OperatorBridgeController } from './operator-bridge.controller';
import { OperatorBridgeMachineIdentityController } from './operator-bridge-machine-identity.controller';
import { OperatorBridgeMachineIdentityService } from './operator-bridge-machine-identity.service';
import { OperatorBridgeService } from './operator-bridge.service';

@Module({
  imports: [AgentWorkforceModule, AuditModule],
  controllers: [OperatorBridgeController, OperatorBridgeMachineIdentityController],
  providers: [
    OperatorBridgeService,
    OperatorBridgeMachineIdentityService,
    {
      provide: OPERATOR_BRIDGE_CONFIG,
      useFactory: loadOperatorBridgeConfig,
    },
  ],
})
export class OperatorBridgeModule {}
