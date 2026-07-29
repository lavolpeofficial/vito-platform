import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { DigitalEmployeesModule } from './modules/digital-employees/digital-employees.module';
import { CapabilitiesModule } from './modules/capabilities/capabilities.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuditModule } from './modules/audit/audit.module';

/**
 * Seit Sprint 2 gibt es keine `TenantMiddleware` mehr. Authentifizierung
 * und Tenant-Scoping laufen ausschließlich über den global registrierten
 * `JwtAuthGuard` (siehe AuthModule) plus den optionalen, streng
 * eingeschränkten Development-Fallback über `X-Organization-Id`
 * (ADR-003).
 */
@Module({
  imports: [
    CommonModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    UsersModule,
    DigitalEmployeesModule,
    CapabilitiesModule,
    TasksModule,
    AuditModule,
  ],
})
export class AppModule {}
