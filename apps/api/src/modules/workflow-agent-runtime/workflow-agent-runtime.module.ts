import { Module } from '@nestjs/common';
import { AgentWorkforceModule } from '../agent-workforce/agent-workforce.module';
import { LearningModule } from '../learning/learning.module';
import { WorkflowRuntimeModule } from '../workflow-runtime/workflow-runtime.module';
import { WorkflowVerificationModule } from '../workflow-verification/workflow-verification.module';
import { WorkflowAgentRuntimeController } from './workflow-agent-runtime.controller';
import { WorkflowAgentRunnerService } from './workflow-agent-runner.service';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';

@Module({
  imports: [AgentWorkforceModule, WorkflowRuntimeModule, LearningModule, WorkflowVerificationModule],
  controllers: [WorkflowAgentRuntimeController],
  providers: [WorkflowAgentRuntimeService, WorkflowAgentRunnerService],
  exports: [WorkflowAgentRuntimeService, WorkflowAgentRunnerService],
})
export class WorkflowAgentRuntimeModule {}
