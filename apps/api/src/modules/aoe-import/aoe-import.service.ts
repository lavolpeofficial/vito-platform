import { BadRequestException, Injectable } from '@nestjs/common';
import { EmployeeType, RiskLevel } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AoeHandoffPackage, AoeImportResult } from './aoe-import.types';

@Injectable()
export class AoeImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  validate(pkg: AoeHandoffPackage): void {
    if (pkg.deployment_status !== 'DRAFT') throw new BadRequestException('AOE import accepts DRAFT packages only.');
    if (pkg.human_approval_required !== true) throw new BadRequestException('Human approval must be required.');
    if (!pkg.audit_policy?.enabled) throw new BadRequestException('Audit policy must be enabled.');
    if (!Array.isArray(pkg.digital_employees) || pkg.digital_employees.length === 0) throw new BadRequestException('At least one digital employee is required.');
    if (pkg.digital_employees.some((employee) => employee.status !== 'DRAFT')) throw new BadRequestException('All digital employees must remain DRAFT.');
    const codes = new Set(pkg.digital_employees.map((employee) => employee.code));
    for (const capability of pkg.capabilities ?? []) {
      for (const employeeCode of capability.assigned_employee_codes ?? []) {
        if (!codes.has(employeeCode)) throw new BadRequestException(`Unknown employee code in capability assignment: ${employeeCode}`);
      }
    }
  }

  async importDraft(organizationId: string, pkg: AoeHandoffPackage): Promise<AoeImportResult> {
    this.validate(pkg);
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new BadRequestException('Organization not found.');

    return this.prisma.$transaction(async (tx) => {
      const employeesByCode = new Map<string, string>();
      let employeesCreated = 0;
      let capabilitiesCreated = 0;
      let assignmentsCreated = 0;

      for (const employee of pkg.digital_employees) {
        const existing = await tx.digitalEmployee.findUnique({
          where: { organizationId_code: { organizationId, code: employee.code } },
        });
        if (existing && existing.status !== 'DRAFT') {
          throw new BadRequestException(`Refusing to overwrite non-draft employee: ${employee.code}`);
        }
        const record = await tx.digitalEmployee.upsert({
          where: { organizationId_code: { organizationId, code: employee.code } },
          create: {
            organizationId,
            name: employee.name,
            code: employee.code,
            description: employee.description,
            status: 'DRAFT',
            employeeType: employee.employee_type as EmployeeType,
            version: employee.version,
          },
          update: {
            name: employee.name,
            description: employee.description,
            status: 'DRAFT',
            employeeType: employee.employee_type as EmployeeType,
            version: employee.version,
          },
        });
        if (!existing) employeesCreated += 1;
        employeesByCode.set(employee.code, record.id);
      }

      for (const capability of pkg.capabilities ?? []) {
        const existing = await tx.capability.findUnique({
          where: { organizationId_code: { organizationId, code: capability.code } },
        });
        const record = await tx.capability.upsert({
          where: { organizationId_code: { organizationId, code: capability.code } },
          create: {
            organizationId,
            code: capability.code,
            name: capability.name,
            description: capability.description,
            riskLevel: capability.risk_level as RiskLevel,
            requiresApproval: capability.requires_approval,
          },
          update: {
            name: capability.name,
            description: capability.description,
            riskLevel: capability.risk_level as RiskLevel,
            requiresApproval: capability.requires_approval,
          },
        });
        if (!existing) capabilitiesCreated += 1;

        for (const employeeCode of capability.assigned_employee_codes ?? []) {
          const digitalEmployeeId = employeesByCode.get(employeeCode)!;
          await tx.digitalEmployeeCapability.upsert({
            where: { digitalEmployeeId_capabilityId: { digitalEmployeeId, capabilityId: record.id } },
            create: {
              digitalEmployeeId,
              capabilityId: record.id,
              isEnabled: false,
              configuration: {
                source: 'AOE_DWS',
                sourceVariant: pkg.source_variant,
                humanApprovalRequired: true,
              },
            },
            update: {
              isEnabled: false,
              configuration: {
                source: 'AOE_DWS',
                sourceVariant: pkg.source_variant,
                humanApprovalRequired: true,
              },
            },
          });
          assignmentsCreated += 1;
        }
      }

      await this.audit.record({
        organizationId,
        actorType: 'SYSTEM',
        action: 'aoe.handoff.imported_draft',
        entityType: 'DigitalWorkforceBlueprint',
        metadata: {
          sourceVariant: pkg.source_variant,
          employees: pkg.digital_employees.map((employee) => employee.code),
          capabilityCount: pkg.capabilities?.length ?? 0,
          humanApprovalRequired: true,
          executionBoundary: pkg.execution_boundary,
        },
      }, tx);

      return {
        organizationId,
        sourceVariant: pkg.source_variant,
        digitalEmployeesCreated: employeesCreated,
        capabilitiesCreated,
        assignmentsCreated,
        status: 'DRAFT',
      };
    });
  }
}
