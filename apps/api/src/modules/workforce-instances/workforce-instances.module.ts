import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkforceInstancesController } from './workforce-instances.controller';
import { WorkforceInstancesService } from './workforce-instances.service';

@Module({
  imports: [AuditModule],
  controllers: [WorkforceInstancesController],
  providers: [WorkforceInstancesService],
  exports: [WorkforceInstancesService],
})
export class WorkforceInstancesModule {}
