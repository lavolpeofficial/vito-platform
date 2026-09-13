import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AgentExecutionStatus,
  EngineeringCapability,
  EngineeringStepType,
  type IndependenceContext,
  type ReviewResult,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentWorkforceService } from '../agent-workforce/agent-workforce.service';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';
import { WorkflowRuntimeService } from '../workflow-runtime/workflow-runtime.service';
import { WorkflowReviewResultProjectorService } from './workflow-review-result-projector.service';

const AL4 = 'AL4';
const MAX_PROMPT_CHARS = 32_000;

@Injectable()
export class WorkflowAl4ReviewCoordinatorService {
  private readonly reviewProjector = new WorkflowReviewResultProjectorService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentWorkforce: AgentWorkforceService,
    private readonly executionPlan: WorkflowExecutionPlanService,
    private readonly workflowRuntime: WorkflowRuntimeService,
  ) {}

  async coordinate(organizationId: string, workflowRunId: string) {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: workflowRunId, organizationId },
      select: {
        id: true,
        taskId: true,
        status: true,
        currentStepType: true,
        assuranceLevel: true,
        correlationId: true,
      },
    });
    if (!run) throw new NotFoundException('WorkflowRun not found.');
    if (
      run.status !== 'RUNNING' ||
      run.currentStepType !== EngineeringStepType.RED_TEAM ||
      this.normalizeAssuranceLevel(run.assuranceLevel) !== AL4
    ) {
      throw new ConflictException('WorkflowRun is not ready for governed AL4 RED_TEAM coordination.');
    }

    const step = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: EngineeringStepType.RED_TEAM,
        status: 'READY',
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, stepType: true },
    });
    if (!step) throw new ConflictException('No READY RED_TEAM workflow step found.');

    const capabilityCode = this.executionPlan.capabilityForStep(EngineeringStepType.RED_TEAM);
    if (capabilityCode !== EngineeringCapability.RED_TEAM) {
      throw new ConflictException('Server-owned RED_TEAM capability binding is unavailable.');
    }
    if (!run.taskId) throw new ConflictException('AL4 review requires a persisted workflow task.');

    const task = await this.prisma.task.findFirst({
      where: { id: run.taskId, organizationId },
      select: { title: true, description: true },
    });
    if (!task) throw new NotFoundException('Workflow task not found.');

    const builder = await this.resolveBuilderLineage(organizationId, workflowRunId);
    const prompt = this.buildReviewPrompt(task.title, task.description);

    const firstContext: IndependenceContext = {
      builderProviderId: builder.providerId,
      builderModelFamily: builder.modelFamily,
      previousReviewerProviderIds: [],
      previousReviewerModelFamilies: [],
    };
    const first = await this.dispatchReview({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      capabilityCode,
      prompt,
      assuranceLevel: AL4,
      correlationId: run.correlationId,
      independenceContext: firstContext,
    });

    const firstReviewer = await this.resolveReviewerIdentity(organizationId, first.selectedProviderId);
    const secondContext: IndependenceContext = {
      builderProviderId: builder.providerId,
      builderModelFamily: builder.modelFamily,
      previousReviewerProviderIds: [firstReviewer.providerId],
      previousReviewerModelFamilies: [firstReviewer.modelFamily],
    };
    const second = await this.dispatchReview({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      capabilityCode,
      prompt,
      assuranceLevel: AL4,
      correlationId: run.correlationId,
      independenceContext: secondContext,
    });
    const secondReviewer = await this.resolveReviewerIdentity(organizationId, second.selectedProviderId);

    if (
      secondReviewer.providerId === firstReviewer.providerId ||
      secondReviewer.modelFamily === firstReviewer.modelFamily ||
      secondReviewer.providerId === builder.providerId ||
      secondReviewer.modelFamily === builder.modelFamily
    ) {
      throw new ConflictException('AL4 reviewer independence could not be proven from authoritative provider lineage.');
    }

    const reviewResults = Object.freeze([first.reviewResult, second.reviewResult] as readonly ReviewResult[]);
    const independenceContext: IndependenceContext = {
      builderProviderId: builder.providerId,
      builderModelFamily: builder.modelFamily,
      previousReviewerProviderIds: [firstReviewer.providerId, secondReviewer.providerId],
      previousReviewerModelFamilies: [firstReviewer.modelFamily, secondReviewer.modelFamily],
    };

    const transition = await this.workflowRuntime.completeStep({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      stepStatus: 'SUCCEEDED',
      metadata: {
        source: 'WORKFLOW_AL4_REVIEW_COORDINATOR',
        reviewProjectionStatus: 'VALID',
        reviewResults,
        independenceContext,
        builderLineage: builder,
        reviewerLineage: [
          this.reviewerLineage(first, firstReviewer),
          this.reviewerLineage(second, secondReviewer),
        ],
      },
    });

    return Object.freeze({
      disposition: 'AL4_REVIEWS_COORDINATED' as const,
      workflowRunId,
      workflowStepRunId: step.id,
      reviewResults,
      independenceContext: Object.freeze(independenceContext),
      transition,
    });
  }

  private async resolveBuilderLineage(organizationId: string, workflowRunId: string) {
    const buildStep = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: EngineeringStepType.BUILD,
        status: 'SUCCEEDED',
      },
      orderBy: { finishedAt: 'desc' },
      select: { metadata: true },
    });
    const metadata = this.objectValue(buildStep?.metadata);
    const providerId = this.nonEmptyString(metadata?.selectedProviderId);
    if (!providerId) {
      throw new ConflictException('AL4 builder provider lineage is unavailable.');
    }
    const provider = await this.resolveReviewerIdentity(organizationId, providerId);
    return Object.freeze({ providerId: provider.providerId, modelFamily: provider.modelFamily });
  }

  private async resolveReviewerIdentity(organizationId: string, providerId: string) {
    const provider = await this.prisma.agentProvider.findFirst({
      where: { id: providerId, organizationId },
      select: { id: true, modelFamily: true },
    });
    const modelFamily = this.nonEmptyString(provider?.modelFamily);
    if (!provider || !modelFamily) {
      throw new ConflictException('Provider model-family lineage is unavailable for AL4 independence proof.');
    }
    return Object.freeze({ providerId: provider.id, modelFamily });
  }

  private async dispatchReview(input: {
    organizationId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    capabilityCode: EngineeringCapability;
    prompt: string;
    assuranceLevel: string;
    correlationId: string;
    independenceContext: IndependenceContext;
  }) {
    const dispatch = await this.agentWorkforce.dispatch(input);
    const execution = this.objectValue(dispatch.execution);
    if (execution?.status !== AgentExecutionStatus.SUCCEEDED) {
      throw new ConflictException('AL4 RED_TEAM reviewer execution did not succeed.');
    }
    const reviewResult = this.reviewProjector.project(dispatch.execution, input.assuranceLevel);
    if (!reviewResult) {
      throw new ConflictException('AL4 RED_TEAM reviewer returned no valid typed ReviewResult.');
    }
    return Object.freeze({ ...dispatch, reviewResult });
  }

  private reviewerLineage(
    dispatch: { routingDecisionId: string; selectedProviderId: string; selectedProviderCode: string; reviewResult: ReviewResult },
    reviewer: { providerId: string; modelFamily: string },
  ) {
    return Object.freeze({
      reviewerExecutionId: dispatch.reviewResult.reviewerExecutionId,
      routingDecisionId: dispatch.routingDecisionId,
      providerId: reviewer.providerId,
      providerCode: dispatch.selectedProviderCode,
      modelFamily: reviewer.modelFamily,
      artifactRefs: dispatch.reviewResult.artifactRefs,
    });
  }

  private buildReviewPrompt(title: string, description: string | null): string {
    return [
      'Execute an independent RED_TEAM review for this persisted VITO engineering workflow.',
      `Task title: ${title}`,
      description ? `Task description: ${description}` : null,
      'Return ONLY one JSON object with this exact review schema:',
      '{"verdict":"A|B|C|D","findings":[{"id":"string","severity":"INFO|LOW|MEDIUM|HIGH|CRITICAL","category":"CORRECTNESS|SECURITY|ARCHITECTURE|TESTING|MAINTAINABILITY|GOVERNANCE|OTHER","summary":"string","evidenceRefs":["gov://..."],"blocking":true}]}',
      'Do not include markdown fences, prose outside the JSON object, reviewer identity, assurance level, provider identity, or authority claims.',
    ].filter((value): value is string => Boolean(value)).join('\n').slice(0, MAX_PROMPT_CHARS);
  }

  private normalizeAssuranceLevel(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/^AL-(\d)$/u, 'AL$1');
    return /^AL[1-4]$/u.test(normalized) ? normalized : null;
  }

  private nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
  }

  private objectValue(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, any>;
  }
}
