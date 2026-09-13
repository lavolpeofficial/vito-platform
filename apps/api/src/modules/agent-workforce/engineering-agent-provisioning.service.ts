import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DigitalEmployeeStatus, EmployeeType, RiskLevel } from '@prisma/client';
import { EngineeringCapability } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { AuditService } from '../audit/audit.service';

const ENGINEERING_AGENT = Object.freeze({
  code: 'vito-engineer',
  name: 'VITO Engineer',
  description: 'Governed engineering specialist for the VITO platform.',
  employeeType: EmployeeType.SPECIALIST,
  version: '0.1.0',
});

const ENGINEERING_CAPABILITIES = Object.freeze([
  Object.freeze({ code: EngineeringCapability.CODE_PLAN, name: 'Code planning', riskLevel: RiskLevel.MEDIUM, requiresApproval: false }),
  Object.freeze({ code: EngineeringCapability.CODE_BUILD, name: 'Code build', riskLevel: RiskLevel.HIGH, requiresApproval: true }),
  Object.freeze({ code: EngineeringCapability.TEST_EXECUTION, name: 'Test execution', riskLevel: RiskLevel.MEDIUM, requiresApproval: false }),
  Object.freeze({ code: EngineeringCapability.REVIEW_PACKAGE, name: 'Review package', riskLevel: RiskLevel.MEDIUM, requiresApproval: false }),
]);

@Injectable()
export class EngineeringAgentProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async provision() {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('Engineering agent provisioning requires authenticated human governance.');
    }

    return this.prisma.$transaction(async (tx) => {
      let employee = await tx.digitalEmployee.findFirst({
        where: { organizationId, code: ENGINEERING_AGENT.code },
      });

      if (employee) {
        if (
          employee.status !== DigitalEmployeeStatus.DRAFT ||
          employee.employeeType !== ENGINEERING_AGENT.employeeType ||
          employee.name !== ENGINEERING_AGENT.name
        ) {
          throw new ConflictException('Existing vito-engineer does not match the governed DRAFT bootstrap identity.');
        }
      } else {
        employee = await tx.digitalEmployee.create({
          data: {
            organizationId,
            ...ENGINEERING_AGENT,
            status: DigitalEmployeeStatus.DRAFT,
          },
        });
      }

      const capabilityIds: string[] = [];
      for (const declaration of ENGINEERING_CAPABILITIES) {
        let capability = await tx.capability.findFirst({
          where: { organizationId, code: declaration.code },
        });
        if (capability) {
          if (
            capability.riskLevel !== declaration.riskLevel ||
            capability.requiresApproval !== declaration.requiresApproval
          ) {
            throw new ConflictException(`Existing capability ${declaration.code} conflicts with the governed engineering declaration.`);
          }
        } else {
          capability = await tx.capability.create({
            data: {
              organizationId,
              code: declaration.code,
              name: declaration.name,
              description: `Server-owned engineering capability ${declaration.code}.`,
              riskLevel: declaration.riskLevel,
              requiresApproval: declaration.requiresApproval,
            },
          });
        }

        const existingAssignment = await tx.digitalEmployeeCapability.findUnique({
          where: {
            digitalEmployeeId_capabilityId: {
              digitalEmployeeId: employee.id,
              capabilityId: capability.id,
            },
          },
        });
        if (existingAssignment?.isEnabled) {
          throw new ConflictException(`Capability ${declaration.code} is already enabled; bootstrap will not modify active authority.`);
        }
        if (!existingAssignment) {
          await tx.digitalEmployeeCapability.create({
            data: {
              digitalEmployeeId: employee.id,
              capabilityId: capability.id,
              isEnabled: false,
              configuration: {},
            },
          });
        }
        capabilityIds.push(capability.id);
      }

      await this.audit.record(
        {
          organizationId,
          actorType: 'USER',
          actorId: userId,
          action: 'ENGINEERING_AGENT_PROVISIONED',
          entityType: 'DigitalEmployee',
          entityId: employee.id,
          metadata: {
            code: ENGINEERING_AGENT.code,
            status: employee.status,
            capabilityCodes: ENGINEERING_CAPABILITIES.map((item) => item.code),
            allCapabilityAssignmentsEnabled: false,
          },
        },
        tx,
      );

      return Object.freeze({
        digitalEmployeeId: employee.id,
        code: employee.code,
        status: employee.status,
        capabilityIds: Object.freeze(capabilityIds),
        capabilityCodes: Object.freeze(ENGINEERING_CAPABILITIES.map((item) => item.code)),
        capabilitiesEnabled: false,
        requiresActivationGate: true,
      });
    });
  }
}
