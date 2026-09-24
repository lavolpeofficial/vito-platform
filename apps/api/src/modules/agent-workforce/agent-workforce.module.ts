import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { EngineeringReleaseModule } from '../engineering-release/engineering-release.module';
import { GovernedRuntimeModule } from '../governed-runtime/governed-runtime.module';
import { ProviderRegistryModule } from '../provider-registry/provider-registry.module';
import { CloudGovernedExecutionModule } from '../cloud-governed-execution/cloud-governed-execution.module';
import { LearningModule } from '../learning/learning.module';
import { MemoryModule } from '../memory/memory.module';
import { AgentWorkforceController } from './agent-workforce.controller';
import { AgentWorkforceService } from './agent-workforce.service';
import { EngineeringAgentProvisioningService } from './engineering-agent-provisioning.service';
import { WorkflowAgentAssignmentController } from './workflow-agent-assignment.controller';
import { WorkflowAgentAssignmentService } from './workflow-agent-assignment.service';
import { WorkflowExecutionIdentityService } from './workflow-execution-identity.service';
import { WorkflowExecutionPlanService } from './workflow-execution-plan.service';

@Module({
  imports: [
    AuditModule,
    EngineeringReleaseModule,
    ProviderRegistryModule,
    GovernedRuntimeModule,
    CloudGovernedExecutionModule,
    LearningModule,
    MemoryModule,
  ],
  controllers: [AgentWorkforceController, WorkflowAgentAssignmentController],
  providers: [
    AgentWorkforceService,
    EngineeringAgentProvisioningService,
    WorkflowExecutionIdentityService,
    WorkflowExecutionPlanService,
    WorkflowAgentAssignmentService,
  ],
  exports: [
    AgentWorkforceService,
    EngineeringAgentProvisioningService,
    WorkflowExecutionPlanService,
    WorkflowAgentAssignmentService,
  ],
})
export class AgentWorkforceModule {}
