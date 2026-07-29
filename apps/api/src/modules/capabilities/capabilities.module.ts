import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DigitalEmployeesModule } from '../digital-employees/digital-employees.module';
import { CapabilitiesController } from './capabilities.controller';
import { CapabilitiesService } from './capabilities.service';
import { DigitalEmployeeCapabilitiesController } from './digital-employee-capabilities.controller';

@Module({
  imports: [AuditModule, DigitalEmployeesModule],
  controllers: [CapabilitiesController, DigitalEmployeeCapabilitiesController],
  providers: [CapabilitiesService],
  exports: [CapabilitiesService],
})
export class CapabilitiesModule {}
