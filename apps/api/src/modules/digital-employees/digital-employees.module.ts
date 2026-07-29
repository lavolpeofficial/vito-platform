import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DigitalEmployeesController } from './digital-employees.controller';
import { DigitalEmployeesService } from './digital-employees.service';

@Module({
  imports: [AuditModule],
  controllers: [DigitalEmployeesController],
  providers: [DigitalEmployeesService],
  exports: [DigitalEmployeesService],
})
export class DigitalEmployeesModule {}
