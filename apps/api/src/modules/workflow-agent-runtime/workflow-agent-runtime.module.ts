import { Module } from '@nestjs/common';
import { AgentWorkforceModule } from '../agent-workforce/agent-workforce.module';
import { LearningModule } from '../learning/learning.module';
import { WorkflowRuntimeModule } from '../workflow-runtime/workflow-runtime.module';
import { WorkflowAgentRuntimeController } from './workflow-agent-runtime.controller';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';

@Module({
  imports: [AgentWorkforceModule, WorkflowRuntimeModule, LearningModule],
  controllers: [WorkflowAgentRuntimeController],
  providers: [WorkflowAgentRuntimeService],
  exports: [WorkflowAgentRuntimeService],
})
export class WorkflowAgentRuntimeModule {}
