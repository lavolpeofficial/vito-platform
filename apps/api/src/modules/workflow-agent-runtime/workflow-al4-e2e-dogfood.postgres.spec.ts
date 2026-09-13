import { randomUUID } from 'node:crypto';
import {
  AgentExecutionStatus,
  EngineeringCapability,
  EngineeringStepType,
} from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';
import { GoalPlannerService } from '../goal-planner/goal-planner.service';
import { WorkflowObserverService } from '../workflow-observer/workflow-observer.service';
import { HumanReleaseApprovalService } from '../workflow-runtime/human-release-approval.service';
import { WorkflowRuntimeService } from '../workflow-runtime/workflow-runtime.service';
import { WorkflowAl4ReviewCoordinatorService } from './workflow-al4-review-coordinator.service';
import { WorkflowReviewVerdictService } from './workflow-review-verdict.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describePg = DATABASE_URL ? describe : describe.skip;

describePg('VITO AL4 end-to-end dogfood · PostgreSQL proof', () => {
  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const runtime = new WorkflowRuntimeService(prisma, audit);
  const executionPlan = new WorkflowExecutionPlanService(prisma);
  const planner = new GoalPlannerService(
    executionPlan,
    { search: jest.fn().mockResolvedValue([]) } as any,
  );
  const observer = new WorkflowObserverService(prisma);
  const reviewVerdict = new WorkflowReviewVerdictService(
    prisma,
    {} as any,
    runtime,
  );
  const humanRelease = new HumanReleaseApprovalService(prisma, runtime, audit);

  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const builderProviderId = randomUUID();
  const reviewerOneProviderId = randomUUID();
  const reviewerTwoProviderId = randomUUID();

  let runId = '';
  let reviewDispatchCount = 0;

  const agentWorkforce = {
    dispatch: jest.fn(async (input: {
      organizationId: string;
      workflowRunId: string;
      workflowStepRunId: string;
      capabilityCode: string;
      correlationId: string;
    }) => {
      reviewDispatchCount += 1;
      const providerId = reviewDispatchCount === 1
        ? reviewerOneProviderId
        : reviewerTwoProviderId;
      const providerCode = reviewDispatchCount === 1
        ? `dogfood-reviewer-1-${suffix}`
        : `dogfood-reviewer-2-${suffix}`;
      const invocationId = randomUUID();
      const envelopeId = randomUUID();
      const artifactReference = `gov://dogfood/${invocationId}`;
      const now = new Date();

      await prisma.governedOperationEnvelope.create({
        data: {
          id: envelopeId,
          organizationId: input.organizationId,
          purposeCode: 'AL4_DOGFOOD_REVIEW',
          correlationId: input.correlationId,
          status: 'COMPLETED',
        },
      });
      await prisma.governedExecutionRecord.create({
        data: {
          id: invocationId,
          envelopeId,
          organizationId: input.organizationId,
          workflowRunId: input.workflowRunId,
          workflowStepRunId: input.workflowStepRunId,
          capabilityCode: input.capabilityCode,
          providerId,
          status: 'SUCCEEDED',
          startedAt: now,
          completedAt: now,
          durationMs: 1,
          outputReference: `dogfood:${invocationId}`,
          artifactReferences: [artifactReference],
          policyDecisionReference: 'dogfood-policy',
        },
      });

      return Object.freeze({
        routingDecisionId: `route-${reviewDispatchCount}-${suffix}`,
        selectedProviderId: providerId,
        selectedProviderCode: providerCode,
        execution: Object.freeze({
          status: AgentExecutionStatus.SUCCEEDED,
          invocationId,
          artifactReferences: [artifactReference],
          providerExecutionMetadata: {
            stdout: JSON.stringify({ verdict: 'A', findings: [] }),
          },
        }),
      });
    }),
  } as any;

  const coordinator = new WorkflowAl4ReviewCoordinatorService(
    prisma,
    agentWorkforce,
    executionPlan,
    runtime,
  );

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `AL4 Dogfood ${suffix}`,
        slug: `al4-dogfood-${suffix}`,
      },
    });
    await prisma.agentProvider.createMany({
      data: [
        {
          id: builderProviderId,
          organizationId,
          providerCode: `dogfood-builder-${suffix}`,
          displayName: 'Dogfood Builder',
          modelFamily: 'dogfood-builder-family',
        },
        {
          id: reviewerOneProviderId,
          organizationId,
          providerCode: `dogfood-reviewer-1-${suffix}`,
          displayName: 'Dogfood Reviewer 1',
          modelFamily: 'dogfood-review-family-1',
        },
        {
          id: reviewerTwoProviderId,
          organizationId,
          providerCode: `dogfood-reviewer-2-${suffix}`,
          displayName: 'Dogfood Reviewer 2',
          modelFamily: 'dogfood-review-family-2',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.governedExecutionRecord.deleteMany({ where: { organizationId } });
    await prisma.governedOperationEnvelope.deleteMany({ where: { organizationId } });
    await prisma.workflowStepRun.deleteMany({ where: { organizationId } });
    await prisma.workflowRun.deleteMany({ where: { organizationId } });
    await prisma.auditEvent.deleteMany({ where: { organizationId } });
    await prisma.task.deleteMany({ where: { organizationId } });
    await prisma.agentProvider.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it('proves Goal → Plan → Workflow → AL4 reviews → verdict → verify → explicit human boundary', async () => {
    const goal = 'Prove the governed AL4 release path without bypassing human release authority.';
    const plan = await planner.planEngineeringGoal(organizationId, goal, 'AL4');

    expect(plan.assuranceLevel).toBe('AL4');
    expect(plan.providerSelection).toBe('DEFERRED_TO_PROVIDER_ROUTER');
    expect(plan.requiresHumanReleaseApproval).toBe(true);
    expect(plan.steps.map((step) => step.stepType)).toEqual([
      EngineeringStepType.PLAN,
      EngineeringStepType.BUILD,
      EngineeringStepType.TEST,
      EngineeringStepType.PACKAGE,
      EngineeringStepType.RED_TEAM,
      EngineeringStepType.PARSE_VERDICT,
      EngineeringStepType.VERIFY,
      EngineeringStepType.HUMAN_RELEASE_GATE,
      EngineeringStepType.RELEASE_EXECUTION,
      EngineeringStepType.REMOTE_VERIFY,
    ]);

    const task = await prisma.task.create({
      data: {
        organizationId,
        title: goal,
        description: goal,
      },
    });
    const run = await runtime.createRun({
      organizationId,
      taskId: task.id,
      workflowDefinitionCode: 'ENGINEERING_CHANGE',
      workflowDefinitionVersion: plan.plannerVersion,
      assuranceLevel: plan.assuranceLevel,
      maxCorrectionLoops: plan.correctionLoop.maxLoops,
      correlationId: `al4-dogfood-${suffix}`,
    });
    runId = run.id;
    await runtime.startRun(organizationId, run.id);

    for (const stepType of [
      EngineeringStepType.PLAN,
      EngineeringStepType.BUILD,
      EngineeringStepType.TEST,
      EngineeringStepType.PACKAGE,
    ]) {
      const step = await prisma.workflowStepRun.findFirstOrThrow({
        where: {
          organizationId,
          workflowRunId: run.id,
          stepType,
          status: 'READY',
        },
        orderBy: { startedAt: 'desc' },
      });
      const transition = await runtime.completeStep({
        organizationId,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
        metadata: stepType === EngineeringStepType.BUILD
          ? { selectedProviderId: builderProviderId, source: 'AL4_DOGFOOD_EXECUTION' }
          : { source: 'AL4_DOGFOOD_EXECUTION' },
      });
      expect(transition.idempotent).toBe(false);
    }

    const redTeamObservation = await observer.observe(organizationId, run.id);
    expect(redTeamObservation).toMatchObject({
      status: 'RUNNING',
      currentStepType: EngineeringStepType.RED_TEAM,
      nextAction: 'COORDINATE_AL4_REVIEWS',
      authority: 'READ_ONLY',
    });

    const reviewResult = await coordinator.coordinate(organizationId, run.id);
    expect(reviewResult.disposition).toBe('AL4_REVIEWS_COORDINATED');
    expect(reviewResult.reviewResults).toHaveLength(2);
    expect(reviewResult.independenceContext).toEqual({
      builderProviderId,
      builderModelFamily: 'dogfood-builder-family',
      previousReviewerProviderIds: [reviewerOneProviderId, reviewerTwoProviderId],
      previousReviewerModelFamilies: ['dogfood-review-family-1', 'dogfood-review-family-2'],
    });

    const ledgerRows = await prisma.governedExecutionRecord.findMany({
      where: {
        organizationId,
        workflowRunId: run.id,
        capabilityCode: EngineeringCapability.RED_TEAM,
        status: 'SUCCEEDED',
      },
    });
    expect(ledgerRows).toHaveLength(2);

    const verdictObservation = await observer.observe(organizationId, run.id);
    expect(verdictObservation).toMatchObject({
      currentStepType: EngineeringStepType.PARSE_VERDICT,
      nextAction: 'PROCESS_REVIEW_VERDICT',
    });

    const verdictResult = await reviewVerdict.parseAndTransition(organizationId, run.id);
    expect(verdictResult).toMatchObject({
      disposition: 'AL4_VERDICT_TRANSITIONED',
      assuranceLevel: 'AL4',
    });
    if (verdictResult.disposition !== 'AL4_VERDICT_TRANSITIONED') {
      throw new Error(`Expected AL4 verdict transition, got ${verdictResult.disposition}.`);
    }
    expect(verdictResult.reviewerExecutionIds).toHaveLength(2);

    const verifyStep = await prisma.workflowStepRun.findFirstOrThrow({
      where: {
        organizationId,
        workflowRunId: run.id,
        stepType: EngineeringStepType.VERIFY,
        status: 'READY',
      },
      orderBy: { startedAt: 'desc' },
    });
    const verifyTransition = await runtime.completeStep({
      organizationId,
      workflowRunId: run.id,
      workflowStepRunId: verifyStep.id,
      stepStatus: 'SUCCEEDED',
      metadata: { source: 'AL4_DOGFOOD_VERIFY' },
    });
    expect(verifyTransition.outcome).toEqual(
      expect.objectContaining({
        kind: 'NEXT_STEP',
        nextStep: EngineeringStepType.HUMAN_RELEASE_GATE,
      }),
    );

    const humanBoundary = await observer.observe(organizationId, run.id);
    expect(humanBoundary).toMatchObject({
      status: 'RUNNING',
      currentStepType: EngineeringStepType.HUMAN_RELEASE_GATE,
      nextAction: 'APPROVE_HUMAN_RELEASE',
      authority: 'READ_ONLY',
    });

    const releaseExecutionSteps = await prisma.workflowStepRun.count({
      where: {
        organizationId,
        workflowRunId: run.id,
        stepType: EngineeringStepType.RELEASE_EXECUTION,
      },
    });
    expect(releaseExecutionSteps).toBe(0);

    await expect(humanRelease.approve({
      organizationId,
      workflowRunId: run.id,
      approvedByUserId: 'machine-dogfood',
      isMachineIdentity: true,
    })).rejects.toThrow('Human release approval requires an authenticated human user.');

    const stillAtBoundary = await prisma.workflowRun.findFirstOrThrow({
      where: { id: run.id, organizationId },
    });
    expect(stillAtBoundary.currentStepType).toBe(EngineeringStepType.HUMAN_RELEASE_GATE);
    expect(stillAtBoundary.status).toBe('RUNNING');
    expect(runId).toBe(run.id);
  });
});
