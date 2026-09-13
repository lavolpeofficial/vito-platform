import { Module } from '@nestjs/common';
import { AgentWorkforceModule } from '../agent-workforce/agent-workforce.module';
import { LearningModule } from '../learning/learning.module';
import { WorkflowRuntimeModule } from '../workflow-runtime/workflow-runtime.module';
import { WorkflowVerificationModule } from '../workflow-verification/workflow-verification.module';
import { WorkflowAgentRuntimeController } from './workflow-agent-runtime.controller';
import { WorkflowAgentRunnerService } from './workflow-agent-runner.service';
import { WorkflowAgentRuntimeService } from './workflow-agent-runtime.service';
import { WorkflowAl4ReviewCoordinatorService } from './workflow-al4-review-coordinator.service';
import { WorkflowReviewEvidenceService } from './workflow-review-evidence.service';
import { WorkflowReviewVerdictService } from './workflow-review-verdict.service';

@Module({
  imports: [AgentWorkforceModule, WorkflowRuntimeModule, LearningModule, WorkflowVerificationModule],
  controllers: [WorkflowAgentRuntimeController],
  providers: [
    WorkflowAgentRuntimeService,
    WorkflowAgentRunnerService,
    WorkflowAl4ReviewCoordinatorService,
    WorkflowReviewEvidenceService,
    WorkflowReviewVerdictService,
  ],
  exports: [
    WorkflowAgentRuntimeService,
    WorkflowAgentRunnerService,
    WorkflowAl4ReviewCoordinatorService,
    WorkflowReviewEvidenceService,
    WorkflowReviewVerdictService,
  ],
})
export class WorkflowAgentRuntimeModule {}
