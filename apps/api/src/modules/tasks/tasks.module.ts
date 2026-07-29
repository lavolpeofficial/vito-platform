import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DigitalEmployeesModule } from '../digital-employees/digital-employees.module';
import { UsersModule } from '../users/users.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AuditModule, UsersModule, DigitalEmployeesModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
