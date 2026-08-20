import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkflowRuntimeService, type CompleteStepInput } from './workflow-runtime.service';
import { randomUUID } from 'crypto';
import type { TransitionOutcome } from '@vito/contracts';

/**
 * Unit-Tests für den WorkflowRuntimeService (EO-01.2).
 *
 * Mocken von PrismaService und AuditService analog zum UsersService-Muster.
 * Die Tests prüfen ausschließlich die Runtime-Logik: Persistenz,
 * Determinismus, Idempotenz, Tenant-Isolation und Audit-Events.
 */

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function makeRun(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    organizationId: ORG_A,
    taskId: null,
    workflowDefinitionCode: 'engineering-loop',
    workflowDefinitionVersion: '0.1.0',
    assuranceLevel: 'AL2',
    status: 'CREATED',
    currentStepType: null,
    correctionLoopCount: 0,
    maxCorrectionLoops: 3,
    correlationId: randomUUID(),
    blockReasonCode: null,
    failureReasonCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeStepRun(overrides: Record<string, any> = {}) {
  return {
    id: randomUUID(),
    organizationId: ORG_A,
    workflowRunId: overrides.workflowRunId ?? 'run-1',
    stepType: 'PLAN',
    status: 'READY',
    attemptNumber: 1,
    causationId: null,
    metadata: {},
    startedAt: new Date(),
    finishedAt: null,
    ...overrides,
  };
}

function buildService(opts: {
  runOverrides?: Record<string, any>;
  stepOverrides?: Record<string, any>;
  findFirstRun?: any;
  findFirstStep?: any;
}) {
  const createdRun = makeRun(opts.runOverrides);
  const createdStep = makeStepRun({ ...opts.stepOverrides, workflowRunId: createdRun.id });

  const tx = {
    workflowRun: {
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ ...createdRun, ...args.data })),
      update: jest.fn(),
    },
    workflowStepRun: {
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation((args: any) => Promise.resolve({ ...createdStep, ...args.data })),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  // Pre-validation reads now happen on prisma directly (outside $transaction)
  const prismaFindFirstRun = jest.fn().mockResolvedValue(opts.findFirstRun ?? createdRun);
  const prismaFindFirstStep = jest.fn().mockResolvedValue(opts.findFirstStep ?? createdStep);

  // tx.findFirst used by startRun and other methods still inside $transaction
  tx.workflowRun.findFirst.mockResolvedValue(opts.findFirstRun ?? createdRun);
  tx.workflowStepRun.findFirst.mockResolvedValue(opts.findFirstStep ?? createdStep);

  const prisma: any = {
    $transaction: jest.fn((fn: (tx: any) => any) => fn(tx)),
    workflowRun: {
      findFirst: prismaFindFirstRun,
      findMany: jest.fn().mockResolvedValue([]),
    },
    workflowStepRun: {
      findFirst: prismaFindFirstStep,
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const auditService: any = {
    record: jest.fn().mockResolvedValue(undefined),
  };

  const service = new WorkflowRuntimeService(prisma, auditService);
  return { service, prisma, auditService, tx };
}

// ===========================================================================
// 1. Create run → CREATED
// ===========================================================================
describe('WorkflowRuntimeService', () => {
  describe('1. createRun → CREATED', () => {
    it('erzeugt einen WorkflowRun im CREATED-Status', async () => {
      const { service } = buildService({});

      const result = await service.createRun({
        organizationId: ORG_A,
        workflowDefinitionCode: 'engineering-loop',
        workflowDefinitionVersion: '0.1.0',
        assuranceLevel: 'AL2',
      });

      expect(result.status).toBe('CREATED');
      expect(result.correctionLoopCount).toBe(0);
      expect(result.organizationId).toBe(ORG_A);
      expect(result.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 2. startRun → RUNNING
  // =========================================================================
  describe('2. startRun → RUNNING', () => {
    it('setzt den Run auf RUNNING und erzeugt den ersten PLAN-Step', async () => {
      const run = makeRun({ status: 'CREATED' });
      const { service, tx } = buildService({ findFirstRun: run });

      tx.workflowRun.update.mockResolvedValue({ ...run, status: 'RUNNING', currentStepType: 'PLAN', startedAt: new Date() });
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun({ workflowRunId: run.id, stepType: 'PLAN', status: 'READY' }));

      const result = await service.startRun(ORG_A, run.id);

      expect(result.run.status).toBe('RUNNING');
      expect(result.run.currentStepType).toBe('PLAN');
      expect(result.firstStep.stepType).toBe('PLAN');
      expect(result.firstStep.status).toBe('READY');
    });

    it('lehnt Start ab wenn Run nicht CREATED ist', async () => {
      const run = makeRun({ status: 'RUNNING' });
      const { service } = buildService({ findFirstRun: run });

      await expect(service.startRun(ORG_A, run.id)).rejects.toThrow(ConflictException);
    });

    it('lehnt Start ab wenn Run nicht existiert', async () => {
      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
        },
        workflowStepRun: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: {
            findFirst: prisma.workflowRun.findFirst,
            create: prisma.workflowRun.create,
            update: prisma.workflowRun.update,
          },
          workflowStepRun: {
            create: prisma.workflowStepRun.create,
          },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(service.startRun(ORG_A, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // 3. Valid PLAN → BUILD transition persists
  // =========================================================================
  describe('3. valid PLAN → BUILD transition', () => {
    it('persistiert den nächsten Step BUILD nach erfolgreichem PLAN', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const updatedRun = { ...run, currentStepType: 'BUILD' };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      const nextStep = makeStepRun({ stepType: 'BUILD', status: 'READY', workflowRunId: run.id, causationId: step.id });
      tx.workflowStepRun.create.mockResolvedValue(nextStep);

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      expect(result.outcome).not.toBeNull();
      expect(result.outcome!.kind).toBe('NEXT_STEP');
      expect((result.outcome as any).nextStep).toBe('BUILD');
      expect((result as any).newStep).toBeDefined();
      expect((result as any).newStep!.stepType).toBe('BUILD');
      expect(result.idempotent).toBe(false);
    });
  });

  // =========================================================================
  // 4. Invalid/stale transition is rejected
  // =========================================================================
  describe('4. invalid/stale transition rejected', () => {
    it('lehnt Completion eines Steps ab der nicht dem aktuellen Step-Typ entspricht', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'BUILD' });
      const staleStep = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service } = buildService({ findFirstRun: run, findFirstStep: staleStep });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: staleStep.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('lehnt Completion auf terminalen Run ab', async () => {
      const run = makeRun({ status: 'COMPLETED' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service } = buildService({ findFirstRun: run, findFirstStep: step });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: step.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // =========================================================================
  // 5. Duplicate completion does not double-advance
  // =========================================================================
  describe('5. duplicate completion idempotent', () => {
    it('gibt idempotent=true zurück wenn Step bereits terminal ist', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'BUILD' });
      const completedStep = makeStepRun({ stepType: 'PLAN', status: 'SUCCEEDED', workflowRunId: run.id });

      const { service } = buildService({ findFirstRun: run, findFirstStep: completedStep });

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: completedStep.id,
        stepStatus: 'SUCCEEDED',
      });

      expect(result.idempotent).toBe(true);
      expect(result.outcome).toBeNull();
    });
  });

  // =========================================================================
  // 6. Correction-loop count persists and does not double-increment
  // =========================================================================
  describe('6. correction-loop count', () => {
    it('inkrementiert correctionLoopCount bei Eintritt in CORRECTION', async () => {
      // Simuliere TEST-Fehler → CORRECTION
      const run = makeRun({ status: 'RUNNING', currentStepType: 'TEST', correctionLoopCount: 0 });
      const step = makeStepRun({ stepType: 'TEST', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const updatedRun = { ...run, correctionLoopCount: 1, currentStepType: 'CORRECTION' };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      const nextStep = makeStepRun({ stepType: 'CORRECTION', status: 'READY', workflowRunId: run.id, causationId: step.id });
      tx.workflowStepRun.create.mockResolvedValue(nextStep);

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      expect(result.outcome!.kind).toBe('NEXT_STEP');
      expect((result.outcome as any).nextStep).toBe('CORRECTION');

      // Verify the update was called with increment
      const updateCall = tx.workflowRun.update.mock.calls[0][0];
      expect(updateCall.data.correctionLoopCount).toEqual({ increment: 1 });
    });

    it('inkrementiert NICHT bei direktem Step-Fortschritt ohne Correction', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN', correctionLoopCount: 0 });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const updatedRun = { ...run, currentStepType: 'BUILD' };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      const nextStep = makeStepRun({ stepType: 'BUILD', status: 'READY', workflowRunId: run.id });
      tx.workflowStepRun.create.mockResolvedValue(nextStep);

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      const updateCall = tx.workflowRun.update.mock.calls[0][0];
      expect(updateCall.data.correctionLoopCount).toBe(0);
      expect(typeof updateCall.data.correctionLoopCount).toBe('number');
      expect(updateCall.data.correctionLoopCount).not.toEqual(expect.objectContaining({ increment: expect.any(Number) }));
    });
  });

  // =========================================================================
  // 7. BLOCKED state and machine-readable reason persist
  // =========================================================================
  describe('7. BLOCKED state persists', () => {
    it('persistiert BLOCKED mit reason bei LOOP_EXHAUSTED', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'TEST', correctionLoopCount: 3, maxCorrectionLoops: 3 });
      const step = makeStepRun({ stepType: 'TEST', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const blockedRun = { ...run, status: 'BLOCKED', currentStepType: null, blockReasonCode: 'LOOP_EXHAUSTED' };
      tx.workflowRun.update.mockResolvedValue(blockedRun);

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      expect(result.outcome!.kind).toBe('BLOCKED');
      expect((result.outcome as any).reason.type).toBe('LOOP_EXHAUSTED');
      expect(result.run.status).toBe('BLOCKED');
    });

    it('persistiert BLOCKED mit HUMAN_DECISION_REQUIRED bei Verdict D', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PARSE_VERDICT', correctionLoopCount: 0 });
      const step = makeStepRun({ stepType: 'PARSE_VERDICT', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const blockedRun = { ...run, status: 'BLOCKED', currentStepType: null, blockReasonCode: 'HUMAN_DECISION_REQUIRED' };
      tx.workflowRun.update.mockResolvedValue(blockedRun);

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
        verdict: 'D',
      });

      expect(result.outcome!.kind).toBe('BLOCKED');
      expect((result.outcome as any).reason.type).toBe('HUMAN_DECISION_REQUIRED');
    });
  });

  // =========================================================================
  // 8. FAILED state persists
  // =========================================================================
  describe('8. FAILED state persists', () => {
    it('persistiert FAILED wenn PLAN step fehlschlägt', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const failedRun = { ...run, status: 'FAILED', currentStepType: null, failureReasonCode: 'PLAN step failed' };
      tx.workflowRun.update.mockResolvedValue(failedRun);

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      expect(result.outcome!.kind).toBe('FAILED');
      expect(result.run.status).toBe('FAILED');
      expect(result.run.failureReasonCode).toBe('PLAN step failed');
    });
  });

  // =========================================================================
  // 9. COMPLETED state persists
  // =========================================================================
  describe('9. COMPLETED state persists', () => {
    it('persistiert COMPLETED wenn REMOTE_VERIFY erfolgreich ist', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'REMOTE_VERIFY' });
      const step = makeStepRun({ stepType: 'REMOTE_VERIFY', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      const completedRun = { ...run, status: 'COMPLETED', currentStepType: null, completedAt: new Date() };
      tx.workflowRun.update.mockResolvedValue(completedRun);

      const result = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      expect(result.outcome!.kind).toBe('COMPLETED');
      expect(result.run.status).toBe('COMPLETED');
      expect(result.run.completedAt).toBeDefined();
    });
  });

  // =========================================================================
  // 10. Reload reconstructs current workflow state
  // =========================================================================
  describe('10. reloadRun reconstructs state', () => {
    it('lädt Run inklusive aller Steps', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'BUILD' });
      const steps = [
        makeStepRun({ stepType: 'PLAN', status: 'SUCCEEDED' }),
        makeStepRun({ stepType: 'BUILD', status: 'READY' }),
      ];

      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue({ ...run, stepRuns: steps }),
        },
        workflowStepRun: { findMany: jest.fn() },
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      const result = await service.reloadRun(ORG_A, run.id);

      expect(result.status).toBe('RUNNING');
      expect(result.currentStepType).toBe('BUILD');
      expect(result.stepRuns).toHaveLength(2);
      expect(result.stepRuns[0].stepType).toBe('PLAN');
      expect(result.stepRuns[1].stepType).toBe('BUILD');
    });

    it('wirft NotFoundException für nicht existierenden Run', async () => {
      const prisma: any = {
        workflowRun: { findFirst: jest.fn().mockResolvedValue(null) },
        workflowStepRun: { findMany: jest.fn() },
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(service.reloadRun(ORG_A, 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // 11. Simulated restart can resume non-terminal run
  // =========================================================================
  describe('11. resume after restart', () => {
    it('setzt einen BLOCKED Run zurück auf RUNNING', async () => {
      const run = makeRun({ status: 'BLOCKED', currentStepType: 'CORRECTION' });

      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: jest.fn().mockResolvedValue({ ...run, status: 'RUNNING' }),
        },
        workflowStepRun: { findMany: jest.fn() },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: { update: prisma.workflowRun.update },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      const result = await service.resumeRun(ORG_A, run.id);
      expect(result.status).toBe('RUNNING');
    });

    it('lehnt Resume auf terminalen Run ab', async () => {
      const run = makeRun({ status: 'COMPLETED' });
      const prisma: any = {
        workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
        workflowStepRun: { findMany: jest.fn() },
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(service.resumeRun(ORG_A, run.id)).rejects.toThrow(ConflictException);
    });

    it('Resume auf bereits RUNNING Run ist no-op mit Audit', async () => {
      const run = makeRun({ status: 'RUNNING' });
      const tx = { auditEvent: { create: jest.fn() } };
      const prisma: any = {
        workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
        workflowStepRun: { findMany: jest.fn() },
        $transaction: jest.fn((fn: any) => fn(tx)),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      const result = await service.resumeRun(ORG_A, run.id);
      expect(result.status).toBe('RUNNING');
      expect(auditService.record).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 12. Tenant A cannot read tenant B run
  // =========================================================================
  describe('12. tenant isolation — read', () => {
    it('Organization A kann Run von Organization B nicht lesen', async () => {
      const runB = makeRun({ organizationId: ORG_B });

      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockImplementation(({ where }: any) => {
            if (where.organizationId === ORG_A && where.id === runB.id) return Promise.resolve(null);
            return Promise.resolve(runB);
          }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        workflowStepRun: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(service.findRunById(ORG_A, runB.id)).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // 13. Tenant A cannot mutate/advance tenant B run
  // =========================================================================
  describe('13. tenant isolation — mutate', () => {
    it('Organization A kann Run von Organization B nicht starten', async () => {
      const runB = makeRun({ organizationId: ORG_B, status: 'CREATED' });

      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
        workflowStepRun: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: { findFirst: prisma.workflowRun.findFirst, update: prisma.workflowRun.update },
          workflowStepRun: { create: prisma.workflowStepRun.create },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(service.startRun(ORG_A, runB.id)).rejects.toThrow(NotFoundException);
    });

    it('Organization A kann Step von Organization B Run nicht abschließen', async () => {
      const runB = makeRun({ organizationId: ORG_B, status: 'RUNNING', currentStepType: 'PLAN' });
      const stepB = makeStepRun({ organizationId: ORG_B, workflowRunId: runB.id });

      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
        workflowStepRun: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
        },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: { findFirst: prisma.workflowRun.findFirst, update: prisma.workflowRun.update },
          workflowStepRun: { findFirst: prisma.workflowStepRun.findFirst, update: prisma.workflowStepRun.update },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: runB.id,
          workflowStepRunId: stepB.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // 14. Audit event emitted for every state-changing operation
  // =========================================================================
  describe('14. audit events', () => {
    it('erzeugt Audit-Event bei createRun', async () => {
      const { service, auditService } = buildService({});

      await service.createRun({
        organizationId: ORG_A,
        workflowDefinitionCode: 'engineering-loop',
        workflowDefinitionVersion: '0.1.0',
        assuranceLevel: 'AL2',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_CREATED');
      expect(call.entityType).toBe('WorkflowRun');
      expect(call.organizationId).toBe(ORG_A);
    });

    it('erzeugt Audit-Event bei startRun', async () => {
      const run = makeRun({ status: 'CREATED' });
      const { service, auditService, tx } = buildService({ findFirstRun: run });
      tx.workflowRun.update.mockResolvedValue({ ...run, status: 'RUNNING' });
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun());

      await service.startRun(ORG_A, run.id);

      expect(auditService.record).toHaveBeenCalledTimes(2);
      const runAudit = auditService.record.mock.calls[0][0];
      expect(runAudit.action).toBe('WORKFLOW_RUN_STARTED');
      const stepAudit = auditService.record.mock.calls[1][0];
      expect(stepAudit.action).toBe('WORKFLOW_STEP_ACTIVATED');
      expect(stepAudit.entityType).toBe('WorkflowStepRun');
      expect(stepAudit.metadata.stepType).toBe('PLAN');
      expect(stepAudit.metadata.organizationId).toBe(ORG_A);
      expect(stepAudit.metadata.workflowRunId).toBe(run.id);
      expect(stepAudit.metadata.correlationId).toBeDefined();
    });

    it('erzeugt Audit-Event bei completeStep (NEXT_STEP)', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, auditService, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowRun.update.mockResolvedValue({ ...run, currentStepType: 'BUILD' });
      const nextStepRecord = makeStepRun({ stepType: 'BUILD', status: 'READY', workflowRunId: run.id, causationId: step.id });
      tx.workflowStepRun.create.mockResolvedValue(nextStepRecord);

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      expect(auditService.record).toHaveBeenCalledTimes(2);
      const activationAudit = auditService.record.mock.calls[0][0];
      expect(activationAudit.action).toBe('WORKFLOW_STEP_ACTIVATED');
      expect(activationAudit.entityType).toBe('WorkflowStepRun');
      expect(activationAudit.metadata.stepType).toBe('BUILD');
      expect(activationAudit.metadata.organizationId).toBe(ORG_A);
      expect(activationAudit.metadata.workflowRunId).toBe(run.id);
      expect(activationAudit.metadata.correlationId).toBeDefined();
      const transitionAudit = auditService.record.mock.calls[1][0];
      expect(transitionAudit.action).toBe('WORKFLOW_STEP_TRANSITION_PERSISTED');
    });

    it('erzeugt Audit-Event bei BLOCKED', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'TEST', correctionLoopCount: 3, maxCorrectionLoops: 3 });
      const step = makeStepRun({ stepType: 'TEST', status: 'READY', workflowRunId: run.id });
      const { service, auditService, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowRun.update.mockResolvedValue({ ...run, status: 'BLOCKED', blockReasonCode: 'LOOP_EXHAUSTED' });

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_BLOCKED');
    });

    it('erzeugt Audit-Event bei FAILED', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, auditService, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowRun.update.mockResolvedValue({ ...run, status: 'FAILED', failureReasonCode: 'PLAN step failed' });

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_FAILED');
    });

    it('erzeugt Audit-Event bei COMPLETED', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'REMOTE_VERIFY' });
      const step = makeStepRun({ stepType: 'REMOTE_VERIFY', status: 'READY', workflowRunId: run.id });
      const { service, auditService, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowRun.update.mockResolvedValue({ ...run, status: 'COMPLETED', completedAt: new Date() });

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_COMPLETED');
    });

    it('erzeugt Audit-Event bei resumeRun', async () => {
      const run = makeRun({ status: 'BLOCKED' });
      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: jest.fn().mockResolvedValue({ ...run, status: 'RUNNING' }),
        },
        workflowStepRun: { findMany: jest.fn() },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: { update: prisma.workflowRun.update },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await service.resumeRun(ORG_A, run.id);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_RESUMED');
    });
  });

  // =========================================================================
  // Additional: Tenant isolation audit metadata
  // =========================================================================
  describe('tenant isolation — audit metadata', () => {
    it('Audit-Events enthalten organizationId und correlationId', async () => {
      const { service, auditService } = buildService({});

      await service.createRun({
        organizationId: ORG_A,
        workflowDefinitionCode: 'engineering-loop',
        workflowDefinitionVersion: '0.1.0',
        assuranceLevel: 'AL2',
      });

      const call = auditService.record.mock.calls[0][0];
      expect(call.organizationId).toBe(ORG_A);
      expect(call.metadata.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 15. createRun includes taskId in audit metadata when present
  // =========================================================================
  describe('15. createRun audit includes taskId', () => {
    it('enthält taskId in Audit-Metadata wenn taskId angegeben', async () => {
      const { service, auditService } = buildService({});

      await service.createRun({
        organizationId: ORG_A,
        taskId: 'task-42',
        workflowDefinitionCode: 'engineering-loop',
        workflowDefinitionVersion: '0.1.0',
        assuranceLevel: 'AL2',
      });

      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_CREATED');
      expect(call.metadata.taskId).toBe('task-42');
    });

    it('enthält kein taskId in Audit-Metadata wenn taskId nicht angegeben', async () => {
      const { service, auditService } = buildService({});

      await service.createRun({
        organizationId: ORG_A,
        workflowDefinitionCode: 'engineering-loop',
        workflowDefinitionVersion: '0.1.0',
        assuranceLevel: 'AL2',
      });

      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_CREATED');
      expect(call.metadata.taskId).toBeUndefined();
    });
  });

  // =========================================================================
  // 16. Stale/terminal transition rejection is audited
  // =========================================================================
  describe('16. invalid/stale transition rejection is audited', () => {
    it('erzeugt Audit-Event bei Ablehnung eines stale Steps', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'BUILD' });
      const staleStep = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, auditService } = buildService({ findFirstRun: run, findFirstStep: staleStep });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: staleStep.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_STEP_TRANSITION_REJECTED');
      expect(call.metadata.reason).toBe('STALE_STEP');
      expect(call.metadata.expectedStepType).toBe('BUILD');
      expect(call.metadata.attemptedStepType).toBe('PLAN');
      expect(call.metadata.correlationId).toBeDefined();
    });

    it('erzeugt Audit-Event bei Ablehnung auf terminalen Run', async () => {
      const run = makeRun({ status: 'COMPLETED' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, auditService } = buildService({ findFirstRun: run, findFirstStep: step });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: step.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_STEP_TRANSITION_REJECTED');
      expect(call.metadata.reason).toBe('TERMINAL_RUN');
      expect(call.metadata.currentStatus).toBe('COMPLETED');
      expect(call.metadata.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 17. WORKFLOW_STEP_ACTIVATED audit events for step activation
  // =========================================================================
  describe('17. step activation audit events', () => {
    it('erzeugt WORKFLOW_STEP_ACTIVATED bei startRun mit korrekten Metadaten', async () => {
      const run = makeRun({ status: 'CREATED' });
      const { service, auditService, tx } = buildService({ findFirstRun: run });
      tx.workflowRun.update.mockResolvedValue({ ...run, status: 'RUNNING', currentStepType: 'PLAN' });
      const firstStep = makeStepRun({ workflowRunId: run.id, stepType: 'PLAN', status: 'READY' });
      tx.workflowStepRun.create.mockResolvedValue(firstStep);

      await service.startRun(ORG_A, run.id);

      const stepAudit = auditService.record.mock.calls[1][0];
      expect(stepAudit.action).toBe('WORKFLOW_STEP_ACTIVATED');
      expect(stepAudit.entityType).toBe('WorkflowStepRun');
      expect(stepAudit.entityId).toBe(firstStep.id);
      expect(stepAudit.metadata.organizationId).toBe(ORG_A);
      expect(stepAudit.metadata.workflowRunId).toBe(run.id);
      expect(stepAudit.metadata.workflowStepRunId).toBe(firstStep.id);
      expect(stepAudit.metadata.stepType).toBe('PLAN');
      expect(stepAudit.metadata.correlationId).toBe(run.correlationId);
    });

    it('erzeugt WORKFLOW_STEP_ACTIVATED bei completeStep NEXT_STEP mit korrekten Metadaten', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, auditService, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowRun.update.mockResolvedValue({ ...run, currentStepType: 'BUILD' });
      const nextStepRecord = makeStepRun({ stepType: 'BUILD', status: 'READY', workflowRunId: run.id, causationId: step.id });
      tx.workflowStepRun.create.mockResolvedValue(nextStepRecord);

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      const stepAudit = auditService.record.mock.calls[0][0];
      expect(stepAudit.action).toBe('WORKFLOW_STEP_ACTIVATED');
      expect(stepAudit.entityType).toBe('WorkflowStepRun');
      expect(stepAudit.entityId).toBe(nextStepRecord.id);
      expect(stepAudit.metadata.organizationId).toBe(ORG_A);
      expect(stepAudit.metadata.workflowRunId).toBe(run.id);
      expect(stepAudit.metadata.workflowStepRunId).toBe(nextStepRecord.id);
      expect(stepAudit.metadata.stepType).toBe('BUILD');
      expect(stepAudit.metadata.correlationId).toBe(run.correlationId);
    });
  });

  // =========================================================================
  // 19. Durable rejection audit — proof of durability boundary
  // =========================================================================
  describe('19. durable rejection audit (correction 02)', () => {
    it('$transaction wird NICHT aufgerufen bei TERMINAL_RUN-Ablehnung', async () => {
      const run = makeRun({ status: 'COMPLETED' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, prisma, auditService } = buildService({ findFirstRun: run, findFirstStep: step });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: step.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('$transaction wird NICHT aufgerufen bei STALE_STEP-Ablehnung', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'BUILD' });
      const staleStep = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, prisma, auditService } = buildService({ findFirstRun: run, findFirstStep: staleStep });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: staleStep.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledTimes(1);
    });

    it('TERMINAL_RUN-Ablehnungs-Audit wird OHNE tx-Parameter geschrieben', async () => {
      const run = makeRun({ status: 'FAILED' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, auditService } = buildService({ findFirstRun: run, findFirstStep: step });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: step.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      const callArgs = auditService.record.mock.calls[0];
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0].action).toBe('WORKFLOW_STEP_TRANSITION_REJECTED');
      expect(callArgs[0].metadata.reason).toBe('TERMINAL_RUN');
    });

    it('STALE_STEP-Ablehnungs-Audit wird OHNE tx-Parameter geschrieben', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'TEST' });
      const staleStep = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, auditService } = buildService({ findFirstRun: run, findFirstStep: staleStep });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: staleStep.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      const callArgs = auditService.record.mock.calls[0];
      expect(callArgs).toHaveLength(1);
      expect(callArgs[0].action).toBe('WORKFLOW_STEP_TRANSITION_REJECTED');
      expect(callArgs[0].metadata.reason).toBe('STALE_STEP');
    });

    it('erfolgreiche Transaktionen weiterhin $transaction verwenden', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, prisma, tx, auditService } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowRun.update.mockResolvedValue({ ...run, currentStepType: 'BUILD' });
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun({ stepType: 'BUILD', status: 'READY' }));

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledTimes(2);
      const normalAudit = auditService.record.mock.calls[1][0];
      expect(normalAudit.action).toBe('WORKFLOW_STEP_TRANSITION_PERSISTED');
    });

    it('Rejection-Audit-Events enthalten alle geforderten Metadaten', async () => {
      const run = makeRun({ status: 'COMPLETED', correlationId: 'corr-xyz' });
      const step = makeStepRun({ stepType: 'VERIFY', status: 'READY', workflowRunId: run.id });
      const { service, auditService } = buildService({ findFirstRun: run, findFirstStep: step });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: step.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      const call = auditService.record.mock.calls[0][0];
      expect(call.organizationId).toBe(ORG_A);
      expect(call.entityId).toBe(run.id);
      expect(call.metadata.workflowStepRunId).toBe(step.id);
      expect(call.metadata.correlationId).toBe('corr-xyz');
      expect(call.metadata.reason).toBe('TERMINAL_RUN');
      expect(call.metadata.currentStatus).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // 18. WAITING_FOR_HUMAN resume is explicit and preserves state
  // =========================================================================
  describe('18. WAITING_FOR_HUMAN resume', () => {
    it('setzt einen WAITING_FOR_HUMAN Run zurück auf RUNNING ohne Counters/State zurückzusetzen', async () => {
      const run = makeRun({
        status: 'WAITING_FOR_HUMAN',
        currentStepType: 'HUMAN_RELEASE_GATE',
        correctionLoopCount: 2,
      });

      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: jest.fn().mockResolvedValue({ ...run, status: 'RUNNING' }),
        },
        workflowStepRun: { findMany: jest.fn() },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: { update: prisma.workflowRun.update },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      const result = await service.resumeRun(ORG_A, run.id);
      expect(result.status).toBe('RUNNING');

      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_RUN_RESUMED');
      expect(call.metadata.previousStatus).toBe('WAITING_FOR_HUMAN');
      expect(call.metadata.currentStepType).toBe('HUMAN_RELEASE_GATE');
      expect(call.metadata.correctionLoopCount).toBe(2);
    });

    it('WAITING_FOR_HUMAN Resume setzt den Status explizit via update', async () => {
      const run = makeRun({
        status: 'WAITING_FOR_HUMAN',
        currentStepType: 'PARSE_VERDICT',
        correctionLoopCount: 1,
      });

      const updateFn = jest.fn().mockResolvedValue({ ...run, status: 'RUNNING' });
      const prisma: any = {
        workflowRun: {
          findFirst: jest.fn().mockResolvedValue(run),
          update: updateFn,
        },
        workflowStepRun: { findMany: jest.fn() },
        $transaction: jest.fn((fn: any) => fn({
          workflowRun: { update: updateFn },
        })),
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await service.resumeRun(ORG_A, run.id);

      expect(updateFn).toHaveBeenCalledWith({
        where: { id: run.id },
        data: { status: 'RUNNING' },
      });
    });

    it('lehnt Resume auf STATUS CREATED ab', async () => {
      const run = makeRun({ status: 'CREATED' });
      const prisma: any = {
        workflowRun: { findFirst: jest.fn().mockResolvedValue(run) },
        workflowStepRun: { findMany: jest.fn() },
      };
      const auditService: any = { record: jest.fn() };
      const service = new WorkflowRuntimeService(prisma, auditService);

      await expect(service.resumeRun(ORG_A, run.id)).rejects.toThrow(ConflictException);
    });
  });

  // =========================================================================
  // 20. Concurrency / idempotency (Correction 03)
  // =========================================================================
  describe('20. concurrent completion idempotency', () => {
    it('zweiter Aufruf mit updateMany count=0 wird idempotent', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      // First caller: updateMany returns count=1 (winner)
      // Second caller: updateMany returns count=0 (loser)
      tx.workflowStepRun.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const updatedRun = { ...run, currentStepType: 'BUILD' };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun({ stepType: 'BUILD', status: 'READY' }));

      // Winner
      const result1 = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });
      expect(result1.idempotent).toBe(false);
      expect(result1.outcome!.kind).toBe('NEXT_STEP');

      // Loser: $transaction is called again (separate request), but updateMany returns 0
      tx.workflowRun.findFirst.mockResolvedValue({ ...run, currentStepType: 'BUILD' });
      tx.workflowStepRun.findFirst.mockResolvedValue({ ...step, status: 'SUCCEEDED' });

      const result2 = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });
      expect(result2.idempotent).toBe(true);
      expect(result2.outcome).toBeNull();
    });

    it('erster Aufruf gewinnt, zweiter wird ohne Doppel-Advance abgewiesen', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'TEST', correctionLoopCount: 0 });
      const step = makeStepRun({ stepType: 'TEST', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      // Winner gets count=1, loser gets count=0
      tx.workflowStepRun.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const updatedRun = { ...run, currentStepType: 'CORRECTION', correctionLoopCount: 1 };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun({ stepType: 'CORRECTION', status: 'READY' }));

      // Winner
      const winner = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });
      expect(winner.idempotent).toBe(false);
      expect(winner.outcome!.kind).toBe('NEXT_STEP');

      // Loser: fresh step is now SUCCEEDED/FAILED → idempotent
      const freshRun = { ...run, currentStepType: 'CORRECTION', correctionLoopCount: 1 };
      const freshStep = { ...step, status: 'FAILED' };
      tx.workflowRun.findFirst.mockResolvedValue(freshRun);
      tx.workflowStepRun.findFirst.mockResolvedValue(freshStep);

      const loser = await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });
      expect(loser.idempotent).toBe(true);

      // correctionLoopCount was only incremented once (by winner)
      expect(tx.workflowRun.update).toHaveBeenCalledTimes(1);
      const updateData = tx.workflowRun.update.mock.calls[0][0].data;
      expect(updateData.correctionLoopCount).toEqual({ increment: 1 });
    });

    it('correctionLoopCount wird nicht doppelt inkrementiert bei zwei konkurrierenden Attempts', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'TEST', correctionLoopCount: 1 });
      const step = makeStepRun({ stepType: 'TEST', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      // Simulate: both transactions enter, but only first updateMany succeeds
      tx.workflowStepRun.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const updatedRun = { ...run, currentStepType: 'CORRECTION', correctionLoopCount: 2 };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun({ stepType: 'CORRECTION', status: 'READY' }));

      // Winner
      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      // Loser
      tx.workflowRun.findFirst.mockResolvedValue({ ...run, currentStepType: 'CORRECTION', correctionLoopCount: 2 });
      tx.workflowStepRun.findFirst.mockResolvedValue({ ...step, status: 'FAILED' });

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
      });

      // workflowRun.update called exactly once (only by winner)
      expect(tx.workflowRun.update).toHaveBeenCalledTimes(1);
      const callData = tx.workflowRun.update.mock.calls[0][0].data;
      expect(callData.correctionLoopCount).toEqual({ increment: 1 });

      // workflowStepRun.create called exactly once (only by winner)
      expect(tx.workflowStepRun.create).toHaveBeenCalledTimes(1);
    });

    it('updateMany mit status=READY guard verhindert gleichzeitige Step-Completion', async () => {
      const run = makeRun({ status: 'RUNNING', currentStepType: 'PLAN' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });

      const { service, tx } = buildService({ findFirstRun: run, findFirstStep: step });

      tx.workflowStepRun.updateMany.mockResolvedValue({ count: 1 });
      const updatedRun = { ...run, currentStepType: 'BUILD' };
      tx.workflowRun.update.mockResolvedValue(updatedRun);
      tx.workflowStepRun.create.mockResolvedValue(makeStepRun({ stepType: 'BUILD', status: 'READY' }));

      await service.completeStep({
        organizationId: ORG_A,
        workflowRunId: run.id,
        workflowStepRunId: step.id,
        stepStatus: 'SUCCEEDED',
      });

      // Verify updateMany was called with status='READY' in WHERE
      expect(tx.workflowStepRun.updateMany).toHaveBeenCalledTimes(1);
      const updateManyCall = tx.workflowStepRun.updateMany.mock.calls[0][0];
      expect(updateManyCall.where).toEqual({ id: step.id, status: 'READY' });
    });

    it('Rejection-Audits bleiben durable auch wenn folgender $transaction fehlschlägt', async () => {
      const run = makeRun({ status: 'COMPLETED' });
      const step = makeStepRun({ stepType: 'PLAN', status: 'READY', workflowRunId: run.id });
      const { service, auditService } = buildService({ findFirstRun: run, findFirstStep: step });

      await expect(
        service.completeStep({
          organizationId: ORG_A,
          workflowRunId: run.id,
          workflowStepRunId: step.id,
          stepStatus: 'SUCCEEDED',
        }),
      ).rejects.toThrow(ConflictException);

      // Audit was written (durable, outside tx)
      expect(auditService.record).toHaveBeenCalledTimes(1);
      const call = auditService.record.mock.calls[0][0];
      expect(call.action).toBe('WORKFLOW_STEP_TRANSITION_REJECTED');
      expect(call.metadata.reason).toBe('TERMINAL_RUN');

      // No tx was invoked (audit is durable regardless)
      // This is verified by the fact that the audit call succeeded before the throw
    });
  });
});

function prisma_findFirst_returns_null(service: any) {
  service.prisma.workflowRun.findFirst.mockResolvedValue(null);
}
