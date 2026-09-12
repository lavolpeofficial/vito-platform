import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EngineeringStepType } from '@vito/contracts';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowExecutionPlanService } from './workflow-execution-plan.service';

export interface WorkflowAgentAssignment {
  readonly id: string;
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly stepType: string;
  readonly capabilityCode: string;
  readonly digitalEmployeeId: string;
  readonly status: 'APPROVED' | 'REVOKED';
  readonly approvedByUserId: string;
  readonly approvalRef: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type Row = {
  id: string;
  organization_id: string;
  workflow_run_id: string;
  step_type: string;
  capability_code: string;
  digital_employee_id: string;
  status: 'APPROVED' | 'REVOKED';
  approved_by_user_id: string;
  approval_ref: string;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class WorkflowAgentAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
    private readonly executionPlan: WorkflowExecutionPlanService,
  ) {}

  async approve(input: {
    workflowRunId: string;
    stepType: EngineeringStepType;
    digitalEmployeeId: string;
    approvalRef: string;
  }): Promise<WorkflowAgentAssignment> {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('Workflow agent assignment requires authenticated human governance.');
    }
    const approvalRef = input.approvalRef?.trim();
    if (!approvalRef || approvalRef.length > 512) {
      throw new BadRequestException('approvalRef must contain between 1 and 512 characters.');
    }

    const run = await this.prisma.workflowRun.findFirst({
      where: { id: input.workflowRunId, organizationId },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');

    const capabilityCode = this.executionPlan.capabilityForStep(input.stepType);
    if (!capabilityCode) {
      throw new BadRequestException('This workflow step is a governance boundary and cannot be assigned to an agent.');
    }

    const employee = await this.prisma.digitalEmployee.findFirst({
      where: {
        id: input.digitalEmployeeId,
        organizationId,
        status: 'ACTIVE',
        capabilities: {
          some: {
            isEnabled: true,
            capability: { organizationId, code: capabilityCode },
          },
        },
      },
      select: { id: true, code: true },
    });
    if (!employee) {
      throw new BadRequestException('DigitalEmployee is not active and enabled for the required server-owned capability.');
    }

    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      INSERT INTO "workflow_agent_assignments" (
        "id", "organization_id", "workflow_run_id", "step_type", "capability_code",
        "digital_employee_id", "status", "approved_by_user_id", "approval_ref"
      ) VALUES (
        ${randomUUID()}, ${organizationId}, ${run.id}, ${input.stepType}, ${capabilityCode},
        ${employee.id}, 'APPROVED', ${userId}, ${approvalRef}
      )
      ON CONFLICT ("organization_id", "workflow_run_id", "step_type")
      DO UPDATE SET
        "capability_code" = EXCLUDED."capability_code",
        "digital_employee_id" = EXCLUDED."digital_employee_id",
        "status" = 'APPROVED',
        "approved_by_user_id" = EXCLUDED."approved_by_user_id",
        "approval_ref" = EXCLUDED."approval_ref",
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING *
    `);
    const assignment = mapRow(rows[0]);

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'WORKFLOW_AGENT_ASSIGNMENT_APPROVED',
      entityType: 'WorkflowAgentAssignment',
      entityId: assignment.id,
      metadata: {
        workflowRunId: assignment.workflowRunId,
        stepType: assignment.stepType,
        capabilityCode: assignment.capabilityCode,
        digitalEmployeeId: assignment.digitalEmployeeId,
        approvalRef: assignment.approvalRef,
      },
    });
    return assignment;
  }

  async revoke(workflowRunId: string, stepType: EngineeringStepType): Promise<WorkflowAgentAssignment> {
    const organizationId = this.tenantContext.getOrThrow();
    const userId = this.tenantContext.getUserId();
    if (this.tenantContext.getAuthenticationMethod() !== 'jwt' || !userId) {
      throw new BadRequestException('Workflow agent assignment revocation requires authenticated human governance.');
    }
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      UPDATE "workflow_agent_assignments"
      SET "status" = 'REVOKED', "updated_at" = CURRENT_TIMESTAMP
      WHERE "organization_id" = ${organizationId}
        AND "workflow_run_id" = ${workflowRunId}
        AND "step_type" = ${stepType}
        AND "status" = 'APPROVED'
      RETURNING *
    `);
    if (!rows[0]) throw new NotFoundException('Approved workflow agent assignment not found.');
    const assignment = mapRow(rows[0]);
    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'WORKFLOW_AGENT_ASSIGNMENT_REVOKED',
      entityType: 'WorkflowAgentAssignment',
      entityId: assignment.id,
      metadata: { workflowRunId, stepType, digitalEmployeeId: assignment.digitalEmployeeId },
    });
    return assignment;
  }

  async resolveApproved(
    organizationId: string,
    workflowRunId: string,
    stepType: string,
  ): Promise<WorkflowAgentAssignment | null> {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT * FROM "workflow_agent_assignments"
      WHERE "organization_id" = ${organizationId}
        AND "workflow_run_id" = ${workflowRunId}
        AND "step_type" = ${stepType}
        AND "status" = 'APPROVED'
      LIMIT 1
    `);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async list(workflowRunId: string): Promise<readonly WorkflowAgentAssignment[]> {
    const organizationId = this.tenantContext.getOrThrow();
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT * FROM "workflow_agent_assignments"
      WHERE "organization_id" = ${organizationId} AND "workflow_run_id" = ${workflowRunId}
      ORDER BY "created_at" ASC
    `);
    return Object.freeze(rows.map(mapRow));
  }
}

function mapRow(row: Row | undefined): WorkflowAgentAssignment {
  if (!row) throw new Error('Workflow agent assignment operation returned no row.');
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    workflowRunId: row.workflow_run_id,
    stepType: row.step_type,
    capabilityCode: row.capability_code,
    digitalEmployeeId: row.digital_employee_id,
    status: row.status,
    approvedByUserId: row.approved_by_user_id,
    approvalRef: row.approval_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
