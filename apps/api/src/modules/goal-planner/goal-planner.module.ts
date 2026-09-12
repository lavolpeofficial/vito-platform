import { Module } from '@nestjs/common';
import { AgentWorkforceModule } from '../agent-workforce/agent-workforce.module';
import { MemoryModule } from '../memory/memory.module';
import { SourceVaultModule } from '../source-vault/source-vault.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkflowRuntimeModule } from '../workflow-runtime/workflow-runtime.module';
import { GoalPlannerController } from './goal-planner.controller';
import { GoalPlannerService } from './goal-planner.service';

@Module({
  imports: [
    AgentWorkforceModule,
    SourceVaultModule,
    MemoryModule,
    TasksModule,
    WorkflowRuntimeModule,
  ],
  controllers: [GoalPlannerController],
  providers: [GoalPlannerService],
  exports: [GoalPlannerService],
})
export class GoalPlannerModule {}
