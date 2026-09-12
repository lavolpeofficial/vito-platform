import { Module } from '@nestjs/common';
import { WorkflowObserverController } from './workflow-observer.controller';
import { WorkflowObserverService } from './workflow-observer.service';

@Module({
  controllers: [WorkflowObserverController],
  providers: [WorkflowObserverService],
  exports: [WorkflowObserverService],
})
export class WorkflowObserverModule {}
