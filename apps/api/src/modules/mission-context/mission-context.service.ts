import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const MAX_TIMELINE_EVENTS = 80;
const MAX_RUNTIME_EVENTS = 12;
const MAX_SHARED_MEMORY_ITEMS = 8;
const MAX_OBJECTIVE_CHARS = 2_000;
const MAX_MEMORY_TITLE_CHARS = 256;
const MAX_MEMORY_SOURCE_CHARS = 256;

interface SharedMemoryRow {
  id: string;
  kind: string;
  title: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: number | null;
  createdAt: Date;
}

export interface MissionRuntimeContext {
  readonly missionId: string;
  readonly objective: string;
  readonly workflow: Readonly<{
    definitionCode: string;
    definitionVersion: string;
    status: string;
    currentStepType: string | null;
    assuranceLevel: string;
  }>;
  readonly progress: Readonly<{
    completedSteps: readonly string[];
    currentStepType: string | null;
    correctionLoopCount: number;
    maxCorrectionLoops: number;
  }>;
  readonly governance: Readonly<{
    waitingForHuman: boolean;
    recentEvents: readonly Readonly<{ action: string; createdAt: string }>[];
  }>;
  readonly memoryRefs: readonly Readonly<{
    id: string;
    kind: string;
    title: string;
    sourceType: string;
    sourceRef: string | null;
    confidence: number | null;
  }>[];
  readonly outcome: Readonly<{
    terminal: boolean;
    status: string;
    blockReasonCode: string | null;
    failureReasonCode: string | null;
  }>;
  readonly authority: 'ADVISORY_CONTEXT';
}

@Injectable()
export class MissionContextService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      include: {
        stepRuns: {
          orderBy: { startedAt: 'asc' },
          select: {
            id: true,
            stepType: true,
            status: true,
            attemptNumber: true,
            causationId: true,
            startedAt: true,
            finishedAt: true,
          },
        },
      },
    });
    if (!run) throw new NotFoundException('Mission workflow not found.');

    const [task, events, memory] = await Promise.all([
      run.taskId
        ? this.prisma.task.findFirst({
            where: { id: run.taskId, organizationId },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              assignedDigitalEmployeeId: true,
            },
          })
        : Promise.resolve(null),
      this.prisma.auditEvent.findMany({
        where: {
          organizationId,
          entityId: { in: [run.id, ...run.stepRuns.map((step) => step.id)] },
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_TIMELINE_EVENTS,
        select: {
          id: true,
          actorType: true,
          actorId: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
      this.sharedWorkflowMemory(organizationId, run.id),
    ]);

    const objective = this.objective(task?.description, task?.title, run.workflowDefinitionCode);
    const runtime = this.toRuntimeContext(run, objective, events, memory);

    return Object.freeze({
      ...runtime,
      organizationId,
      task: task ? Object.freeze(task) : null,
      steps: Object.freeze(run.stepRuns),
      timeline: Object.freeze([...events].reverse()),
      timelineTruncated: events.length === MAX_TIMELINE_EVENTS,
      observedAt: new Date(),
      semantics: Object.freeze({
        missionIdentity: 'WORKFLOW_RUN_ID' as const,
        contextIsAuthority: false,
        memoryCanOverrideGovernance: false,
        providerSelectionIsServerOwned: true,
      }),
    });
  }

  async runtimeContext(organizationId: string, workflowRunId: string): Promise<MissionRuntimeContext> {
    const snapshot = await this.snapshot(organizationId, workflowRunId);
    return Object.freeze({
      missionId: snapshot.missionId,
      objective: snapshot.objective,
      workflow: snapshot.workflow,
      progress: snapshot.progress,
      governance: snapshot.governance,
      memoryRefs: snapshot.memoryRefs,
      outcome: snapshot.outcome,
      authority: 'ADVISORY_CONTEXT',
    });
  }

  private toRuntimeContext(
    run: {
      id: string;
      workflowDefinitionCode: string;
      workflowDefinitionVersion: string;
      status: string;
      currentStepType: string | null;
      assuranceLevel: string;
      correctionLoopCount: number;
      maxCorrectionLoops: number;
      blockReasonCode: string | null;
      failureReasonCode: string | null;
      stepRuns: readonly { stepType: unknown; status: unknown }[];
    },
    objective: string,
    events: readonly { action: string; createdAt: Date }[],
    memory: readonly SharedMemoryRow[],
  ): MissionRuntimeContext {
    const completedSteps = run.stepRuns
      .filter((step) => step.status === 'SUCCEEDED')
      .map((step) => String(step.stepType));

    const waitingForHuman =
      run.status === 'WAITING_FOR_HUMAN' ||
      run.currentStepType === 'HUMAN_RELEASE_GATE' ||
      run.status === 'BLOCKED';

    const terminal = run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED';

    return Object.freeze({
      missionId: run.id,
      objective,
      workflow: Object.freeze({
        definitionCode: run.workflowDefinitionCode,
        definitionVersion: run.workflowDefinitionVersion,
        status: run.status,
        currentStepType: run.currentStepType,
        assuranceLevel: run.assuranceLevel,
      }),
      progress: Object.freeze({
        completedSteps: Object.freeze(completedSteps),
        currentStepType: run.currentStepType,
        correctionLoopCount: run.correctionLoopCount,
        maxCorrectionLoops: run.maxCorrectionLoops,
      }),
      governance: Object.freeze({
        waitingForHuman,
        recentEvents: Object.freeze(events.slice(0, MAX_RUNTIME_EVENTS).map((event) => Object.freeze({
          action: event.action,
          createdAt: event.createdAt.toISOString(),
        }))),
      }),
      memoryRefs: Object.freeze(memory.map((entry) => Object.freeze({
        id: entry.id,
        kind: entry.kind,
        title: entry.title.slice(0, MAX_MEMORY_TITLE_CHARS),
        sourceType: entry.sourceType.slice(0, MAX_MEMORY_SOURCE_CHARS),
        sourceRef: entry.sourceRef?.slice(0, MAX_MEMORY_SOURCE_CHARS) ?? null,
        confidence: entry.confidence,
      }))),
      outcome: Object.freeze({
        terminal,
        status: run.status,
        blockReasonCode: run.blockReasonCode,
        failureReasonCode: run.failureReasonCode,
      }),
      authority: 'ADVISORY_CONTEXT',
    });
  }

  private objective(description: string | null | undefined, title: string | null | undefined, definitionCode: string): string {
    const candidate = description?.trim() || title?.trim() || `Execute governed workflow ${definitionCode}.`;
    return candidate.slice(0, MAX_OBJECTIVE_CHARS);
  }

  private sharedWorkflowMemory(organizationId: string, workflowRunId: string): Promise<SharedMemoryRow[]> {
    return this.prisma.$queryRaw<SharedMemoryRow[]>(Prisma.sql`
      SELECT "id", "kind", "title", "sourceType", "sourceRef", "confidence", "createdAt"
      FROM "memory_entries"
      WHERE "organizationId" = ${organizationId}
        AND "status" = 'ACTIVE'
        AND "scope" = 'WORKFLOW'
        AND "scopeId" = ${workflowRunId}
      ORDER BY "createdAt" DESC
      LIMIT ${MAX_SHARED_MEMORY_ITEMS}
    `);
  }
}
