import { Module } from '@nestjs/common';
import { AgentWorkforceModule } from '../agent-workforce/agent-workforce.module';
import { WorkflowObserverController } from './workflow-observer.controller';
import { WorkflowObserverService } from './workflow-observer.service';

@Module({
  imports: [AgentWorkforceModule],
  controllers: [WorkflowObserverController],
  providers: [WorkflowObserverService],
  exports: [WorkflowObserverService],
})
export class WorkflowObserverModule {}
