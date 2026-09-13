import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const MAX_TIMELINE_EVENTS = 200;

export type WorkflowBoundary =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'BLOCKED'
  | 'TERMINAL_COMPLETE'
  | 'TERMINAL_FAILURE'
  | 'UNKNOWN';

export type WorkflowNextAction =
  | 'START_RUN'
  | 'EXECUTE_CURRENT_STEP'
  | 'PROCESS_REVIEW_VERDICT'
  | 'RESUME_RUN'
  | 'APPROVE_HUMAN_RELEASE'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'NONE';

@Injectable()
export class WorkflowObserverService {
  constructor(private readonly prisma: PrismaService) {}

  async observe(organizationId: string, workflowRunId: string) {
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

    if (!run) throw new NotFoundException('WorkflowRun nicht gefunden.');

    const entityIds = [run.id, ...run.stepRuns.map((step) => step.id)];
    const events = await this.prisma.auditEvent.findMany({
      where: { organizationId, entityId: { in: entityIds } },
      orderBy: { createdAt: 'asc' },
      take: MAX_TIMELINE_EVENTS,
      select: { id: true, actorType: true, actorId: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true },
    });

    const boundary = this.classifyBoundary(run.status);
    const nextAction = this.classifyNextAction(
      run.status,
      run.currentStepType,
      run.blockReasonCode,
      run.assuranceLevel,
    );

    return {
      workflowRunId: run.id, organizationId, correlationId: run.correlationId, status: run.status,
      currentStepType: run.currentStepType, boundary, nextAction, blockReasonCode: run.blockReasonCode,
      failureReasonCode: run.failureReasonCode, correctionLoopCount: run.correctionLoopCount,
      maxCorrectionLoops: run.maxCorrectionLoops, startedAt: run.startedAt, completedAt: run.completedAt,
      steps: run.stepRuns, timeline: events, timelineTruncated: events.length === MAX_TIMELINE_EVENTS,
      observedAt: new Date(), authority: 'READ_ONLY' as const,
    };
  }

  private classifyBoundary(status: string): WorkflowBoundary {
    switch (status) {
      case 'CREATED': return 'NOT_STARTED';
      case 'RUNNING': return 'ACTIVE';
      case 'BLOCKED': return 'BLOCKED';
      case 'COMPLETED': return 'TERMINAL_COMPLETE';
      case 'FAILED':
      case 'CANCELLED': return 'TERMINAL_FAILURE';
      default: return 'UNKNOWN';
    }
  }

  private classifyNextAction(
    status: string,
    currentStepType: string | null,
    blockReasonCode: string | null,
    assuranceLevel: string | null,
  ): WorkflowNextAction {
    if (status === 'CREATED') return 'START_RUN';
    if (status === 'RUNNING' && currentStepType === 'HUMAN_RELEASE_GATE') return 'APPROVE_HUMAN_RELEASE';
    if (status === 'RUNNING' && currentStepType === 'PARSE_VERDICT') {
      return this.serverOwnedVerdictProcessingAllowed(assuranceLevel)
        ? 'PROCESS_REVIEW_VERDICT'
        : 'HUMAN_REVIEW_REQUIRED';
    }
    if (status === 'RUNNING' && currentStepType === 'RELEASE_EXECUTION') return 'HUMAN_REVIEW_REQUIRED';
    if (status === 'RUNNING' && currentStepType) return 'EXECUTE_CURRENT_STEP';
    if (status === 'BLOCKED' && blockReasonCode === 'PROVIDER_BLOCKED') return 'RESUME_RUN';
    if (status === 'BLOCKED') return 'HUMAN_REVIEW_REQUIRED';
    return 'NONE';
  }

  private serverOwnedVerdictProcessingAllowed(assuranceLevel: string | null): boolean {
    if (!assuranceLevel) return false;
    const normalized = assuranceLevel.replace(/^AL-(\d)$/u, 'AL$1');
    return normalized === 'AL1' || normalized === 'AL2' || normalized === 'AL3';
  }
}
