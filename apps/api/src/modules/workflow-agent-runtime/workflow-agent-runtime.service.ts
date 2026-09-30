import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringStepType } from '@vito/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentWorkforceService } from '../agent-workforce/agent-workforce.service';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';
import { RuntimeOutcomeEvaluationService } from '../learning/runtime-outcome-evaluation.service';
import { RuntimeReflectionLearningService } from '../learning/runtime-reflection-learning.service';
import { WorkflowRuntimeService } from '../workflow-runtime/workflow-runtime.service';
import { CodeBuildApprovalService } from '../engineering-release/code-build-approval.service';
import { WorkflowReviewResultProjectorService } from './workflow-review-result-projector.service';
import { WorkflowTestResultProjectorService } from './workflow-test-result-projector.service';
import { buildBoundedExecutionResultSummary } from '../governed-invocation/governed-evidence-binding';
import { type RedTeamEvidenceManifest, WorkflowRedTeamEvidenceHandoffService } from './workflow-red-team-evidence-handoff.service';
import { type CorrectionContextManifest, WorkflowCorrectionContextHandoffService } from './workflow-correction-context-handoff.service';

const MAX_TASK_CONTEXT_CHARS = 32_000;
const MAX_EXECUTION_EVIDENCE_REFERENCES = 32;
const MAX_EXECUTION_EVIDENCE_REFERENCE_CHARS = 2_048;
const MAX_EXECUTION_EVIDENCE_ID_CHARS = 256;
const MAX_RESULT_SUMMARY_CHARS = 6_000;
const MAX_CHANGED_FILES = 64;
const MAX_CHANGED_FILE_CHARS = 512;

@Injectable()
export class WorkflowAgentRuntimeService {
  private readonly reviewProjector = new WorkflowReviewResultProjectorService();
  private readonly testResultProjector = new WorkflowTestResultProjectorService();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentWorkforce: AgentWorkforceService,
    private readonly executionPlan: WorkflowExecutionPlanService,
    private readonly workflowRuntime: WorkflowRuntimeService,
    private readonly runtimeOutcome?: RuntimeOutcomeEvaluationService,
    private readonly runtimeReflectionLearning?: RuntimeReflectionLearningService,
    @Optional() private readonly codeBuildApprovals?: CodeBuildApprovalService,
    @Optional() private readonly redTeamEvidence?: WorkflowRedTeamEvidenceHandoffService,
    @Optional() private readonly correctionContext?: WorkflowCorrectionContextHandoffService,
  ) {}

  async executeCurrentStep(organizationId: string, workflowRunId: string) {
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
    if (run.status !== 'RUNNING') {
      throw new ConflictException(`WorkflowRun is not RUNNING (current: ${run.status}).`);
    }
    if (!run.currentStepType) {
      throw new ConflictException('WorkflowRun has no current step.');
    }

    const step = await this.prisma.workflowStepRun.findFirst({
      where: {
        organizationId,
        workflowRunId,
        stepType: run.currentStepType,
        status: 'READY',
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, stepType: true, attemptNumber: true },
    });
    if (!step) throw new ConflictException('No READY current workflow step found.');

    const capabilityCode = this.executionPlan.capabilityForStep(step.stepType as EngineeringStepType);
    if (!capabilityCode) {
      return Object.freeze({
        disposition: 'NON_AGENT_STEP' as const,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode: null,
      });
    }

    const codeBuildApproval = capabilityCode === 'CODE_BUILD'
      ? await this.resolveCodeBuildApproval(organizationId, workflowRunId, step.id)
      : undefined;

    if (!run.taskId) throw new ConflictException('Agent-executable workflow requires a task identity.');
    const task = await this.prisma.task.findFirst({
      where: { id: run.taskId, organizationId },
      select: { id: true, title: true, description: true },
    });
    if (!task) throw new NotFoundException('Workflow task not found.');

    const redTeamEvidenceManifest = step.stepType === EngineeringStepType.RED_TEAM
      ? await this.resolveRedTeamEvidence(organizationId, workflowRunId, step.id)
      : null;
    const correctionContextManifest = step.stepType === EngineeringStepType.CORRECTION
      ? await this.resolveCorrectionContext(organizationId, workflowRunId, step.id)
      : null;
    const prompt = this.buildPrompt(
      step.stepType, task.title, task.description, redTeamEvidenceManifest, correctionContextManifest,
    );
    const dispatch = await this.agentWorkforce.dispatch({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      capabilityCode,
      prompt,
      assuranceLevel: run.assuranceLevel,
      correlationId: run.correlationId,
      ...(codeBuildApproval ? { codeBuildApproval } : {}),
    });

    const executionStatus = dispatch.execution.status as AgentExecutionStatus;
    const executionEvidence = this.executionEvidence(dispatch.execution, step.stepType);
    const completionStatus = this.toWorkflowCompletionStatus(executionStatus);
    const providerBlocked =
      executionStatus === AgentExecutionStatus.POLICY_BLOCKED ||
      executionStatus === AgentExecutionStatus.QUOTA_BLOCKED;

    if (providerBlocked) {
      const transition = await this.workflowRuntime.completeStep({
        organizationId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
        providerStatus: executionStatus,
        metadata: {
          source: 'WORKFLOW_AGENT_RUNTIME',
          capabilityCode,
          routingDecisionId: dispatch.routingDecisionId,
          selectedProviderId: dispatch.selectedProviderId,
          selectedProviderCode: dispatch.selectedProviderCode,
          experienceId: dispatch.experienceId,
          executionStatus,
          executionEvidence,
          ...(redTeamEvidenceManifest ? { redTeamEvidenceManifest } : {}),
          ...(correctionContextManifest ? { correctionContextManifest } : {}),
        },
      });
      const outcomeEvaluation = await this.recordOutcome({
        organizationId,
        experienceId: dispatch.experienceId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        transitionKind: transition.outcome?.kind ?? null,
      });
      return Object.freeze({
        disposition: 'EXECUTION_BLOCKED' as const,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        dispatch,
        transition,
        outcomeEvaluation,
      });
    }

    if (!completionStatus) {
      const outcomeEvaluation = await this.recordOutcome({
        organizationId,
        experienceId: dispatch.experienceId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        transitionKind: null,
      });
      return Object.freeze({
        disposition: 'EXECUTION_INCOMPLETE' as const,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        dispatch,
        transition: null,
        outcomeEvaluation,
      });
    }

    const reviewResult =
      step.stepType === EngineeringStepType.RED_TEAM && completionStatus === 'SUCCEEDED'
        ? this.reviewProjector.project(dispatch.execution, run.assuranceLevel)
        : null;

    if (step.stepType === EngineeringStepType.RED_TEAM && completionStatus === 'SUCCEEDED' && !reviewResult) {
      const transition = await this.workflowRuntime.completeStep({
        organizationId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
        metadata: {
          source: 'WORKFLOW_AGENT_RUNTIME',
          capabilityCode,
          routingDecisionId: dispatch.routingDecisionId,
          selectedProviderId: dispatch.selectedProviderId,
          selectedProviderCode: dispatch.selectedProviderCode,
          experienceId: dispatch.experienceId,
          executionStatus,
          executionEvidence,
          ...(redTeamEvidenceManifest ? { redTeamEvidenceManifest } : {}),
          ...(correctionContextManifest ? { correctionContextManifest } : {}),
          reviewProjectionStatus: 'INVALID',
        },
      });
      const outcomeEvaluation = await this.recordOutcome({
        organizationId,
        experienceId: dispatch.experienceId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        transitionKind: transition.outcome?.kind ?? null,
      });
      return Object.freeze({
        disposition: 'REVIEW_RESULT_INVALID' as const,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        dispatch,
        transition,
        outcomeEvaluation,
      });
    }

    const testResult =
      step.stepType === EngineeringStepType.TEST && completionStatus === 'SUCCEEDED'
        ? this.testResultProjector.project(dispatch.execution)
        : null;

    if (step.stepType === EngineeringStepType.TEST && completionStatus === 'SUCCEEDED' && (!testResult || testResult.status !== 'PASS')) {
      const transition = await this.workflowRuntime.completeStep({
        organizationId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepStatus: 'FAILED',
        metadata: {
          source: 'WORKFLOW_AGENT_RUNTIME',
          capabilityCode,
          routingDecisionId: dispatch.routingDecisionId,
          selectedProviderId: dispatch.selectedProviderId,
          selectedProviderCode: dispatch.selectedProviderCode,
          experienceId: dispatch.experienceId,
          executionStatus,
          executionEvidence,
          testResultProjectionStatus: testResult ? 'REJECTED' : 'INVALID',
          testResultStatus: testResult?.status ?? 'INVALID',
          ...(testResult ? { testResult } : {}),
          ...(redTeamEvidenceManifest ? { redTeamEvidenceManifest } : {}),
          ...(correctionContextManifest ? { correctionContextManifest } : {}),
        },
      });
      const outcomeEvaluation = await this.recordOutcome({
        organizationId,
        experienceId: dispatch.experienceId,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        transitionKind: transition.outcome?.kind ?? null,
      });
      return Object.freeze({
        disposition: 'TEST_RESULT_INVALID' as const,
        workflowRunId,
        workflowStepRunId: step.id,
        stepType: step.stepType,
        capabilityCode,
        executionStatus,
        dispatch,
        transition,
        outcomeEvaluation,
      });
    }

    const transition = await this.workflowRuntime.completeStep({
      organizationId,
      workflowRunId,
      workflowStepRunId: step.id,
      stepStatus: completionStatus,
      metadata: {
        source: 'WORKFLOW_AGENT_RUNTIME',
        capabilityCode,
        routingDecisionId: dispatch.routingDecisionId,
        selectedProviderId: dispatch.selectedProviderId,
        selectedProviderCode: dispatch.selectedProviderCode,
        experienceId: dispatch.experienceId,
        executionStatus,
        executionEvidence,
        ...(redTeamEvidenceManifest ? { redTeamEvidenceManifest } : {}),
        ...(correctionContextManifest ? { correctionContextManifest } : {}),
        ...(reviewResult ? { reviewProjectionStatus: 'VALID', reviewResult } : {}),
        ...(testResult ? { testResultProjectionStatus: 'VALID', testResult } : {}),
      },
    });

    const outcomeEvaluation = await this.recordOutcome({
      organizationId,
      experienceId: dispatch.experienceId,
      workflowRunId,
      workflowStepRunId: step.id,
      stepType: step.stepType,
      capabilityCode,
      executionStatus,
      transitionKind: transition.outcome?.kind ?? null,
    });

    return Object.freeze({
      disposition: 'TRANSITIONED' as const,
      workflowRunId,
      workflowStepRunId: step.id,
      stepType: step.stepType,
      capabilityCode,
      executionStatus,
      dispatch,
      transition,
      outcomeEvaluation,
    });
  }

  private async resolveCodeBuildApproval(
    organizationId: string,
    workflowRunId: string,
    workflowStepRunId: string,
  ) {
    if (!this.codeBuildApprovals) {
      throw new ForbiddenException('CODE_BUILD_APPROVAL_RESOLVER_UNAVAILABLE');
    }
    return this.codeBuildApprovals.resolveForWorkflowDispatch(
      organizationId,
      workflowRunId,
      workflowStepRunId,
    );
  }

  private async recordOutcome(input: {
    organizationId: string;
    experienceId: string | null;
    workflowRunId: string;
    workflowStepRunId: string;
    stepType: string;
    capabilityCode: string;
    executionStatus: string;
    transitionKind: string | null;
  }) {
    if (!this.runtimeOutcome || !input.experienceId) return null;
    const outcome = await this.runtimeOutcome.tryRecord({
      organizationId: input.organizationId,
      experienceId: input.experienceId,
      workflowRunId: input.workflowRunId,
      workflowStepRunId: input.workflowStepRunId,
      stepType: input.stepType,
      capabilityCode: input.capabilityCode,
      executionStatus: input.executionStatus,
      transitionKind: input.transitionKind,
    });
    if (outcome && this.runtimeReflectionLearning) {
      await this.runtimeReflectionLearning.tryProcess({
        organizationId: input.organizationId,
        experienceId: input.experienceId,
      });
    }
    return outcome;
  }

  private executionEvidence(execution: unknown, stepType: string): Readonly<Record<string, unknown>> {
    if (!execution || typeof execution !== 'object' || Array.isArray(execution)) {
      return Object.freeze({});
    }
    const source = execution as Record<string, unknown>;
    const evidence: Record<string, unknown> = {};
    const invocationId = this.boundedEvidenceScalar(source.invocationId, MAX_EXECUTION_EVIDENCE_ID_CHARS);
    if (invocationId) evidence.invocationId = invocationId;
    const outputReference = this.boundedEvidenceScalar(source.outputReference, MAX_EXECUTION_EVIDENCE_REFERENCE_CHARS);
    if (outputReference) evidence.outputReference = outputReference;
    const artifactReferences = this.boundedEvidenceReferences(source.artifactReferences);
    if (artifactReferences.length > 0) evidence.artifactReferences = artifactReferences;
    const evidenceReferences = this.boundedEvidenceReferences(source.evidenceReferences);
    if (evidenceReferences.length > 0) evidence.evidenceReferences = evidenceReferences;

    const providerMetadata = this.objectValue(source.providerExecutionMetadata);
    const usageMetadata = this.objectValue(source.usageMetadata);
    const binding = this.objectValue(usageMetadata?.governedEvidenceBinding);
    const baseSha = this.revisionSha(binding?.revisionReference);
    const settling = this.objectValue(providerMetadata?.governedResultSettling);
    if (baseSha) {
      evidence.revision = Object.freeze({
        baseSha,
        changedFiles: this.boundedChangedFiles(settling?.changedFiles),
      });
    }
    if (stepType === EngineeringStepType.TEST || stepType === EngineeringStepType.PACKAGE) {
      const resultSummary = buildBoundedExecutionResultSummary(providerMetadata ?? undefined, MAX_RESULT_SUMMARY_CHARS);
      if (resultSummary) evidence.resultSummary = resultSummary;
    }
    return Object.freeze(evidence);
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private boundedChangedFiles(value: unknown): readonly string[] {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_CHANGED_FILE_CHARS,
    ).slice(0, MAX_CHANGED_FILES));
  }

  private async resolveRedTeamEvidence(organizationId: string, workflowRunId: string, stepRunId: string) {
    if (!this.redTeamEvidence) throw new ConflictException('RED_TEAM_EVIDENCE_HANDOFF_UNAVAILABLE');
    return this.redTeamEvidence.resolve(organizationId, workflowRunId, stepRunId);
  }

  private async resolveCorrectionContext(organizationId: string, workflowRunId: string, stepRunId: string) {
    if (!this.correctionContext) throw new ConflictException('CORRECTION_CONTEXT_HANDOFF_UNAVAILABLE');
    return this.correctionContext.resolve(organizationId, workflowRunId, stepRunId);
  }

  private revisionSha(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^gov:\/\/revision\/([a-f0-9]{40,64})$/u.exec(value);
    return match?.[1] ?? null;
  }

  private boundedEvidenceScalar(value: unknown, maxChars: number): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxChars) return null;
    return value;
  }

  private boundedEvidenceReferences(value: unknown): readonly string[] {
    if (!Array.isArray(value)) return Object.freeze([]);
    return Object.freeze(value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= MAX_EXECUTION_EVIDENCE_REFERENCE_CHARS,
    ).slice(0, MAX_EXECUTION_EVIDENCE_REFERENCES));
  }

  private buildPrompt(
    stepType: string,
    title: string,
    description: string | null,
    redTeamEvidenceManifest: RedTeamEvidenceManifest | null,
    correctionContextManifest: CorrectionContextManifest | null,
  ): string {
    const evidenceContext = redTeamEvidenceManifest
      ? [
          'Authoritative mission-bound evidence follows. It was server-generated from the persisted causation chain and governed execution ledger.',
          'Do not traverse external workflow directories. Review only the current workspace plus this manifest.',
          `RED_TEAM_EVIDENCE_MANIFEST_SHA256: ${redTeamEvidenceManifest.manifestSha256}`,
          `RED_TEAM_EVIDENCE_MANIFEST: ${JSON.stringify(redTeamEvidenceManifest)}`,
        ]
      : [];
    const correctionContext = correctionContextManifest
      ? [
          'Authoritative correction context follows. It was server-generated from the persisted causation chain and governed RED_TEAM execution ledger.',
          'Correct the blocking findings in this manifest only. Do not invent, weaken, or replace the persisted findings.',
          `CORRECTION_CONTEXT_MANIFEST_SHA256: ${correctionContextManifest.manifestSha256}`,
          `CORRECTION_CONTEXT_MANIFEST: ${JSON.stringify(correctionContextManifest)}`,
        ]
      : [];
    const reviewContract = stepType === EngineeringStepType.RED_TEAM
      ? [
          'Return ONLY one JSON object with this exact review schema:',
          '{"verdict":"A|B|C|D","findings":[{"id":"string","severity":"INFO|LOW|MEDIUM|HIGH|CRITICAL","category":"CORRECTNESS|SECURITY|ARCHITECTURE|TESTING|MAINTAINABILITY|GOVERNANCE|OTHER","summary":"string","evidenceRefs":["gov://..."],"blocking":true}]}',
          'Do not include markdown fences, prose outside the JSON object, reviewer identity, assurance level, provider identity, or authority claims.',
        ]
      : [];
    const testContract = stepType === EngineeringStepType.TEST
      ? [
          'Return ONLY one JSON object with this exact test-result schema:',
          '{"status":"PASS|FAIL|BLOCKED","testsExecuted":0,"testsFailed":0,"evidenceRefs":["gov://..."]}',
          'Use PASS only when at least one test was actually executed and testsFailed is 0. Use FAIL when executed tests failed. Use BLOCKED when execution was unavailable or could not establish a test result.',
          'Do not include markdown fences or prose outside the JSON object.',
        ]
      : [];
    return [
      `Execute the persisted VITO engineering workflow step: ${stepType}.`,
      `Task title: ${title}`,
      description ? `Task description: ${description}` : null,
      ...evidenceContext,
      ...correctionContext,
      ...reviewContract,
      ...testContract,
      'Operate only within this workflow step and return bounded execution evidence.',
    ].filter((value): value is string => Boolean(value)).join('\n').slice(0, MAX_TASK_CONTEXT_CHARS);
  }

  private toWorkflowCompletionStatus(status: AgentExecutionStatus): 'SUCCEEDED' | 'FAILED' | null {
    if (status === AgentExecutionStatus.SUCCEEDED) return 'SUCCEEDED';
    if (
      status === AgentExecutionStatus.FAILED ||
      status === AgentExecutionStatus.TIMED_OUT ||
      status === AgentExecutionStatus.CANCELLED
    ) return 'FAILED';
    return null;
  }
}