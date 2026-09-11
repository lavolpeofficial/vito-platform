import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  EXPERIENCE_REPOSITORY,
  ExperienceRepository,
} from './experience-store.types';
import {
  LEARNING_MATURITY_REPOSITORY,
  LearningCandidateRecord,
  LearningMaturityRepository,
} from './learning-maturity.types';
import {
  OUTCOME_REPOSITORY,
  OutcomeRecord,
  OutcomeRepository,
} from './outcome-evaluation.types';
import {
  REFLECTION_REPOSITORY,
  ReflectionRecord,
  ReflectionRepository,
} from './reflection.types';

const RUNTIME_METRIC_CODE = 'workflow_step_execution_status';

export interface RuntimeReflectionLearningInput {
  readonly organizationId: string;
  readonly experienceId: string;
}

export interface RuntimeReflectionLearningResult {
  readonly disposition: 'LEARNING_OBSERVATION_RECORDED' | 'INSUFFICIENT_OBJECTIVE_SIGNAL';
  readonly reflection: ReflectionRecord | null;
  readonly candidate: LearningCandidateRecord | null;
  readonly outcome: OutcomeRecord | null;
}

@Injectable()
export class RuntimeReflectionLearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(EXPERIENCE_REPOSITORY) private readonly experiences: ExperienceRepository,
    @Inject(OUTCOME_REPOSITORY) private readonly outcomes: OutcomeRepository,
    @Inject(REFLECTION_REPOSITORY) private readonly reflections: ReflectionRepository,
    @Inject(LEARNING_MATURITY_REPOSITORY) private readonly maturity: LearningMaturityRepository,
  ) {}

  async process(input: RuntimeReflectionLearningInput): Promise<RuntimeReflectionLearningResult> {
    const experience = await this.experiences.getById(input.organizationId, input.experienceId);
    if (!experience) throw new Error('Runtime Experience not found in organization.');
    if (experience.status !== 'EVALUATED' && experience.status !== 'REFLECTED') {
      return this.insufficient();
    }

    const outcome = (await this.outcomes.listForExperience(input.organizationId, input.experienceId))
      .find((item) => item.metricCode === RUNTIME_METRIC_CODE) ?? null;
    if (!outcome || outcome.score === 0) return this.insufficient(outcome);

    let reflection = (await this.reflections.listForExperience(input.organizationId, input.experienceId))
      .find((item) => item.evidenceOutcomeIds.includes(outcome.id)) ?? null;

    if (!reflection) {
      const observedStatus = printable(outcome.observedValue);
      const expectedStatus = printable(outcome.expectedValue);
      const evidence = asRecord(outcome.evidence);
      const stepType = printable(evidence.stepType);
      const capabilityCode = printable(evidence.capabilityCode);
      const positive = outcome.score > 0;
      const lesson = positive
        ? `Observed ${stepType} with ${capabilityCode}: execution status ${observedStatus} matched expected ${expectedStatus}.`
        : `Observed ${stepType} with ${capabilityCode}: execution status ${observedStatus} did not match expected ${expectedStatus}.`;

      reflection = await this.reflections.create(input.organizationId, {
        experienceId: input.experienceId,
        lesson,
        whatWorked: positive ? [`Execution reached ${observedStatus}.`] : [],
        whatFailed: positive ? [] : [`Execution reached ${observedStatus} instead of ${expectedStatus}.`],
        assumptions: [],
        nextActionHint: null,
        evidenceOutcomeIds: [outcome.id],
        confidence: outcome.confidence,
        reflectorType: 'SYSTEM',
      });
      await this.reflections.markExperienceReflected(input.organizationId, input.experienceId);
      await this.audit.record({
        organizationId: input.organizationId,
        actorType: 'SYSTEM',
        action: 'LEARNING_RUNTIME_REFLECTION_RECORDED',
        entityType: 'ExperienceReflection',
        entityId: reflection.id,
        metadata: {
          experienceId: input.experienceId,
          outcomeId: outcome.id,
          metricCode: outcome.metricCode,
          score: outcome.score,
          confidence: outcome.confidence,
        },
      });
    }

    let candidate = await this.findCandidate(input.organizationId, input.experienceId, reflection.id);
    if (!candidate) {
      const evidence = asRecord(outcome.evidence);
      const stepType = printable(evidence.stepType);
      const capabilityCode = printable(evidence.capabilityCode);
      const observedStatus = printable(outcome.observedValue);
      const expectedStatus = printable(outcome.expectedValue);
      const statement = outcome.score > 0
        ? `In this observed run, ${capabilityCode} for ${stepType} reached expected execution status ${expectedStatus}.`
        : `In this observed run, ${capabilityCode} for ${stepType} reached ${observedStatus} instead of expected ${expectedStatus}.`;

      candidate = await this.maturity.createCandidate(input.organizationId, {
        experienceId: input.experienceId,
        reflectionId: reflection.id,
        statement,
        applicability: {
          source: 'WORKFLOW_AGENT_RUNTIME',
          metricCode: outcome.metricCode,
          stepType,
          capabilityCode,
          observedStatus,
          expectedStatus,
          outcomeScore: outcome.score,
        },
        confidence: outcome.confidence,
      });
      await this.audit.record({
        organizationId: input.organizationId,
        actorType: 'SYSTEM',
        action: 'LEARNING_RUNTIME_CANDIDATE_CREATED',
        entityType: 'LearningCandidate',
        entityId: candidate.id,
        metadata: {
          experienceId: input.experienceId,
          reflectionId: reflection.id,
          outcomeId: outcome.id,
          maturity: candidate.maturity,
          confidence: candidate.confidence,
        },
      });
    }

    return Object.freeze({
      disposition: 'LEARNING_OBSERVATION_RECORDED',
      reflection,
      candidate,
      outcome,
    });
  }

  async tryProcess(input: RuntimeReflectionLearningInput): Promise<RuntimeReflectionLearningResult | null> {
    try {
      return await this.process(input);
    } catch (error) {
      try {
        await this.audit.record({
          organizationId: input.organizationId,
          actorType: 'SYSTEM',
          action: 'LEARNING_RUNTIME_REFLECTION_PIPELINE_FAILED',
          entityType: 'Experience',
          entityId: input.experienceId,
          metadata: { message: error instanceof Error ? error.message : 'unknown error' },
        });
      } catch {}
      return null;
    }
  }

  private insufficient(outcome: OutcomeRecord | null = null): RuntimeReflectionLearningResult {
    return Object.freeze({
      disposition: 'INSUFFICIENT_OBJECTIVE_SIGNAL',
      reflection: null,
      candidate: null,
      outcome,
    });
  }

  private async findCandidate(
    organizationId: string,
    experienceId: string,
    reflectionId: string,
  ): Promise<LearningCandidateRecord | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "learning_candidates"
      WHERE "organization_id" = ${organizationId}
        AND "experience_id" = ${experienceId}
        AND "reflection_id" = ${reflectionId}
        AND "status" = 'ACTIVE'
      ORDER BY "created_at" ASC
      LIMIT 1
    `);
    if (!rows[0]) return null;
    return this.maturity.getCandidate(organizationId, rows[0].id);
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

function printable(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'UNKNOWN';
}
