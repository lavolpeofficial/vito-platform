import { AuditService } from '../audit/audit.service';
import { RuntimeExperienceCaptureService } from './runtime-experience-capture.service';
import { ExperienceRepository } from './experience-store.types';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const agentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function build(options: { agentValid?: boolean; createFails?: boolean } = {}) {
  const repository: jest.Mocked<ExperienceRepository> = {
    agentBelongsToOrganization: jest.fn().mockResolvedValue(options.agentValid ?? true),
    create: options.createFails
      ? jest.fn().mockRejectedValue(new Error('experience store unavailable'))
      : jest.fn().mockImplementation(async (orgId, input) => ({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          organizationId: orgId,
          agentId: input.agentId,
          goal: input.goal,
          context: input.context,
          observation: input.observation,
          decision: input.decision,
          action: input.action,
          result: input.result,
          successScore: input.successScore ?? null,
          confidence: input.confidence ?? null,
          feedback: input.feedback ?? null,
          lesson: input.lesson ?? null,
          reusablePattern: input.reusablePattern ?? null,
          status: 'OBSERVED',
          createdAt: new Date('2026-09-11T04:00:00Z'),
          updatedAt: new Date('2026-09-11T04:00:00Z'),
        })),
    getById: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue({}) } as unknown as jest.Mocked<AuditService>;
  return { service: new RuntimeExperienceCaptureService(audit, repository), repository, audit };
}

const input = {
  organizationId,
  agentId,
  source: 'AGENT_WORKFORCE' as const,
  goal: 'Execute CODE_BUILD for BUILD workflow step.',
  context: { workflowRunId: 'run-1', workflowStepRunId: 'step-1' },
  observation: { priorLearningItemsRetrieved: 2 },
  decision: { routingDecisionId: 'route-1' },
  action: { capabilityCode: 'CODE_BUILD' },
  result: { status: 'SUCCEEDED', executionId: 'exec-1' },
  successScore: null,
  confidence: null,
};

describe('RuntimeExperienceCaptureService', () => {
  it('records runtime experience without inventing outcome quality', async () => {
    const { service, repository, audit } = build();
    const result = await service.record(input);
    expect(result.status).toBe('OBSERVED');
    expect(result.successScore).toBeNull();
    expect(result.confidence).toBeNull();
    expect(repository.agentBelongsToOrganization).toHaveBeenCalledWith(organizationId, agentId);
    expect(repository.create).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ successScore: null, confidence: null }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEARNING_EXPERIENCE_RECORDED',
      actorType: 'DIGITAL_EMPLOYEE',
      actorId: agentId,
      metadata: expect.objectContaining({ source: 'AGENT_WORKFORCE' }),
    }));
  });

  it('fails open for runtime execution and audits a capture failure when possible', async () => {
    const { service, audit } = build({ createFails: true });
    await expect(service.tryRecord(input)).resolves.toBeNull();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LEARNING_RUNTIME_EXPERIENCE_CAPTURE_FAILED',
      entityType: 'WorkflowStepRun',
      entityId: 'step-1',
      metadata: expect.objectContaining({ reason: 'experience store unavailable' }),
    }));
  });
});
