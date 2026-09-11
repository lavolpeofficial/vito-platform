import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface WorkflowExecutionPlanEntry {
  readonly organizationId: string;
  readonly workflowRunId: string;
  readonly stepType: EngineeringStepType;
  readonly capabilityCode: EngineeringCapability;
}

const SERVER_OWNED_CAPABILITY_BY_STEP: Readonly<Partial<Record<EngineeringStepType, EngineeringCapability>>> =
  Object.freeze({
    [EngineeringStepType.PLAN]: EngineeringCapability.CODE_PLAN,
    [EngineeringStepType.BUILD]: EngineeringCapability.CODE_BUILD,
    [EngineeringStepType.TEST]: EngineeringCapability.TEST_EXECUTION,
    [EngineeringStepType.PACKAGE]: EngineeringCapability.REVIEW_PACKAGE,
    [EngineeringStepType.RED_TEAM]: EngineeringCapability.RED_TEAM,
    [EngineeringStepType.CORRECTION]: EngineeringCapability.CODE_BUILD,
    [EngineeringStepType.VERIFY]: EngineeringCapability.RELEASE_VERIFICATION,
    [EngineeringStepType.REMOTE_VERIFY]: EngineeringCapability.RELEASE_VERIFICATION,
  });

interface StoredPlanRow {
  organizationId: string;
  workflowRunId: string;
  stepType: EngineeringStepType;
  capabilityCode: string;
}

@Injectable()
export class WorkflowExecutionPlanService {
  constructor(private readonly prisma: PrismaService) {}

  capabilityForStep(stepType: EngineeringStepType): EngineeringCapability | null {
    return SERVER_OWNED_CAPABILITY_BY_STEP[stepType] ?? null;
  }

  async resolveAndBind(
    organizationId: string,
    workflowRunId: string,
    stepType: EngineeringStepType,
  ): Promise<WorkflowExecutionPlanEntry> {
    const expectedCapability = this.capabilityForStep(stepType);
    if (!expectedCapability) {
      throw new BadRequestException(`Workflow step ${stepType} has no agent-executable capability.`);
    }

    const existing = await this.readEntry(organizationId, workflowRunId, stepType);
    if (existing) return this.assertImmutable(existing, expectedCapability);

    await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "workflow_execution_plan_entries"
          ("id", "organizationId", "workflowRunId", "stepType", "capabilityCode")
        VALUES
          (${randomUUID()}, ${organizationId}, ${workflowRunId}, ${stepType}::"EngineeringStepType", ${expectedCapability})
        ON CONFLICT ("organizationId", "workflowRunId", "stepType") DO NOTHING
      `,
    );

    const bound = await this.readEntry(organizationId, workflowRunId, stepType);
    if (!bound) {
      throw new ConflictException('Workflow execution plan binding could not be persisted.');
    }
    return this.assertImmutable(bound, expectedCapability);
  }

  private async readEntry(
    organizationId: string,
    workflowRunId: string,
    stepType: EngineeringStepType,
  ): Promise<StoredPlanRow | null> {
    const rows = await this.prisma.$queryRaw<StoredPlanRow[]>(
      Prisma.sql`
        SELECT
          "organizationId",
          "workflowRunId",
          "stepType",
          "capabilityCode"
        FROM "workflow_execution_plan_entries"
        WHERE "organizationId" = ${organizationId}
          AND "workflowRunId" = ${workflowRunId}
          AND "stepType" = ${stepType}::"EngineeringStepType"
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  }

  private assertImmutable(
    row: StoredPlanRow,
    expectedCapability: EngineeringCapability,
  ): WorkflowExecutionPlanEntry {
    if (row.capabilityCode !== expectedCapability) {
      throw new ConflictException(
        `Persisted workflow capability ${row.capabilityCode} conflicts with server-owned mapping ${expectedCapability}.`,
      );
    }
    return Object.freeze({
      organizationId: row.organizationId,
      workflowRunId: row.workflowRunId,
      stepType: row.stepType,
      capabilityCode: expectedCapability,
    });
  }
}
