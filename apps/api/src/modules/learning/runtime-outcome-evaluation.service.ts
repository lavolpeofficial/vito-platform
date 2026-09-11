import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  OUTCOME_REPOSITORY,
  OutcomeRecord,
  OutcomeRepository,
} from './outcome-evaluation.types';

const METRIC_CODE = 'workflow_step_execution_status';

export interface RecordRuntimeOutcomeInput {
  readonly organizationId: string;
  readonly experienceId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly stepType: string;
  readonly capabilityCode: string;
  readonly executionStatus: string;
  readonly transitionKind?: string | null;
}

@Injectable()
export class RuntimeOutcomeEvaluationService {
  constructor(
    private readonly audit: AuditService,
    @Inject(OUTCOME_REPOSITORY) private readonly repository: OutcomeRepository,
  ) {}

  async record(input: RecordRuntimeOutcomeInput): Promise<OutcomeRecord> {
    if (!(await this.repository.experienceExists(input.organizationId, input.experienceId))) {
      throw new Error('Runtime Experience not found in organization.');
    }

    const existing = (await this.repository.listForExperience(input.organizationId, input.experienceId))
      .find((item) => item.metricCode === METRIC_CODE);
    if (existing) return existing;

    const score = scoreForStatus(input.executionStatus);
    const outcome = await this.repository.create(input.organizationId, {
      experienceId: input.experienceId,
      metricCode: METRIC_CODE,
      expectedValue: 'SUCCEEDED',
      observedValue: input.executionStatus,
      evidence: {
        source: 'WORKFLOW_AGENT_RUNTIME',
        workflowRunId: input.workflowRunId,
        workflowStepRunId: input.workflowStepRunId,
        stepType: input.stepType,
        capabilityCode: input.capabilityCode,
        executionStatus: input.executionStatus,
        transitionKind: input.transitionKind ?? null,
      },
      score,
      confidence: 1,
      evaluatorType: 'SYSTEM',
    });
    await this.repository.markExperienceEvaluated(input.organizationId, input.experienceId);
    await this.audit.record({
      organizationId: input.organizationId,
      actorType: 'SYSTEM',
      action: 'LEARNING_RUNTIME_OUTCOME_RECORDED',
      entityType: 'ExperienceOutcome',
      entityId: outcome.id,
      metadata: {
        experienceId: input.experienceId,
        metricCode: METRIC_CODE,
        executionStatus: input.executionStatus,
        score,
        confidence: 1,
      },
    });
    return outcome;
  }

  async tryRecord(input: RecordRuntimeOutcomeInput): Promise<OutcomeRecord | null> {
    try {
      return await this.record(input);
    } catch (error) {
      try {
        await this.audit.record({
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: 'LEARNING_RUNTIME_OUTCOME_CAPTURE_FAILED',
          entityType: 'Experience',
          entityId: input.experienceId,
          metadata: { message: error instanceof Error ? error.message : 'unknown error' },
        });
      } catch {}
      return null;
    }
  }
}

function scoreForStatus(status: string): number {
  if (status === 'SUCCEEDED') return 1;
  if (status === 'FAILED' || status === 'TIMED_OUT' || status === 'CANCELLED') return -1;
  return 0;
}
