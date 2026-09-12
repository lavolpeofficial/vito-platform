import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { WorkforceInstancesModule } from './modules/workforce-instances/workforce-instances.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { TeamsModule } from './modules/teams/teams.module';
import { OrganizationRolesModule } from './modules/organization-roles/organization-roles.module';
import { PositionsModule } from './modules/positions/positions.module';
import { OrganizationChartModule } from './modules/organization-chart/organization-chart.module';
import { DigitalEmployeesModule } from './modules/digital-employees/digital-employees.module';
import { CapabilitiesModule } from './modules/capabilities/capabilities.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { AuditModule } from './modules/audit/audit.module';
import { SourceVaultModule } from './modules/source-vault/source-vault.module';
import { AoeImportModule } from './modules/aoe-import/aoe-import.module';
import { WorkflowRuntimeModule } from './modules/workflow-runtime/workflow-runtime.module';
import { ProviderRegistryModule } from './modules/provider-registry/provider-registry.module';
import { GovernedRuntimeModule } from './modules/governed-runtime/governed-runtime.module';
import { AgentWorkforceModule } from './modules/agent-workforce/agent-workforce.module';
import { WorkflowAgentRuntimeModule } from './modules/workflow-agent-runtime/workflow-agent-runtime.module';
import { OperatorBridgeModule } from './modules/operator-bridge/operator-bridge.module';
import { CommandBusModule } from './modules/command-bus/command-bus.module';
import { LearningModule } from './modules/learning/learning.module';
import { CustosModule } from './modules/custos/custos.module';
import { GoalPlannerModule } from './modules/goal-planner/goal-planner.module';
import { MemoryModule } from './modules/memory/memory.module';
import { CapabilityDiscoveryModule } from './modules/capability-discovery/capability-discovery.module';
import { SkillPromotionModule } from './modules/skill-promotion/skill-promotion.module';

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
    WorkforceInstancesModule,
    DepartmentsModule,
    TeamsModule,
    OrganizationRolesModule,
    PositionsModule,
    OrganizationChartModule,
    DigitalEmployeesModule,
    CapabilitiesModule,
    TasksModule,
    AuditModule,
    SourceVaultModule,
    AoeImportModule,
    WorkflowRuntimeModule,
    ProviderRegistryModule,
    CustosModule,
    GovernedRuntimeModule,
    AgentWorkforceModule,
    WorkflowAgentRuntimeModule,
    OperatorBridgeModule,
    CommandBusModule,
    LearningModule,
    GoalPlannerModule,
    MemoryModule,
    CapabilityDiscoveryModule,
    SkillPromotionModule,
  ],
})
export class AppModule {}
