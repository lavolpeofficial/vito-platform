import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaExperienceRepository } from './prisma-experience.repository';
import { PrismaLearningRetrievalRepository } from './prisma-learning-retrieval.repository';
import { PrismaOutcomeRepository } from './prisma-outcome.repository';
import { RuntimeExperienceCaptureService } from './runtime-experience-capture.service';
import { RuntimeOutcomeEvaluationService } from './runtime-outcome-evaluation.service';

describe('Runtime learning loop · PostgreSQL proof', () => {
  const prisma = new PrismaService();
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const experiences = new PrismaExperienceRepository(prisma);
  const outcomes = new PrismaOutcomeRepository(prisma);
  const retrieval = new PrismaLearningRetrievalRepository(prisma);
  const capture = new RuntimeExperienceCaptureService(audit, experiences);
  const evaluate = new RuntimeOutcomeEvaluationService(audit, outcomes);

  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const agentId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.organization.createMany({
      data: [
        { id: organizationId, name: `Learning Proof ${suffix}`, slug: `learning-proof-${suffix}` },
        { id: foreignOrganizationId, name: `Foreign Proof ${suffix}`, slug: `foreign-proof-${suffix}` },
      ],
    });
    await prisma.digitalEmployee.create({
      data: {
        id: agentId,
        organizationId,
        name: 'Learning Loop Proof Agent',
        code: `proof-agent-${suffix}`,
        employeeType: 'SPECIALIST',
        version: '1.0.0',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "experiences" WHERE "organization_id" IN ($1, $2)',
      organizationId,
      foreignOrganizationId,
    );
    await prisma.digitalEmployee.deleteMany({ where: { id: agentId } });
    await prisma.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrganizationId] } } });
    await prisma.$disconnect();
  });

  it('persists Experience → objective Outcome → EVALUATED state → tenant-scoped retrieval', async () => {
    const experience = await capture.record({
      organizationId,
      agentId,
      source: 'AGENT_WORKFORCE',
      goal: 'Execute RELEASE_VERIFICATION with durable release verification evidence.',
      context: {
        workflowRunId: `run-${suffix}`,
        workflowStepRunId: `step-${suffix}`,
        stepType: 'REMOTE_VERIFY',
        capabilityCode: 'RELEASE_VERIFICATION',
      },
      observation: { priorLearningItemsRetrieved: 0 },
      decision: { routingDecisionId: `route-${suffix}` },
      action: { capabilityCode: 'RELEASE_VERIFICATION' },
      result: { status: 'SUCCEEDED', executionId: `execution-${suffix}` },
      successScore: null,
      confidence: null,
    });

    expect(experience.status).toBe('OBSERVED');
    expect(experience.successScore).toBeNull();
    expect(experience.confidence).toBeNull();

    const outcome = await evaluate.record({
      organizationId,
      experienceId: experience.id,
      workflowRunId: `run-${suffix}`,
      workflowStepRunId: `step-${suffix}`,
      stepType: 'REMOTE_VERIFY',
      capabilityCode: 'RELEASE_VERIFICATION',
      executionStatus: 'SUCCEEDED',
      transitionKind: 'COMPLETED',
    });

    expect(outcome.metricCode).toBe('workflow_step_execution_status');
    expect(outcome.observedValue).toBe('SUCCEEDED');
    expect(outcome.score).toBe(1);
    expect(outcome.confidence).toBe(1);

    const evaluatedExperience = await experiences.getById(organizationId, experience.id);
    expect(evaluatedExperience?.status).toBe('EVALUATED');

    const nextRunLearning = await retrieval.retrieve(organizationId, {
      query: 'release verification',
      limit: 8,
    });
    expect(nextRunLearning).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'EXPERIENCE',
          sourceId: experience.id,
          maturity: 'EVALUATED',
        }),
      ]),
    );

    const foreignTenantLearning = await retrieval.retrieve(foreignOrganizationId, {
      query: 'release verification',
      limit: 8,
    });
    expect(foreignTenantLearning).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: experience.id })]),
    );
  });
});
