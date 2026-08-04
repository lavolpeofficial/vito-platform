import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrganizationRolesController } from './organization-roles.controller';
import { OrganizationRolesService } from './organization-roles.service';

@Module({
  imports: [AuditModule],
  controllers: [OrganizationRolesController],
  providers: [OrganizationRolesService],
  exports: [OrganizationRolesService],
})
export class OrganizationRolesModule {}
