import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentExecutionStatus, EngineeringCapability, EngineeringStepType } from '@vito/contracts';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowExecutionPlanService } from '../agent-workforce/workflow-execution-plan.service';

const MANIFEST_VERSION = 'RED_TEAM_EVIDENCE_V2';
const EXPECTED_CAPABILITY: Readonly<Record<string, EngineeringCapability>> = Object.freeze({
  [EngineeringStepType.BUILD]: EngineeringCapability.CODE_BUILD,
  [EngineeringStepType.CORRECTION]: EngineeringCapability.CODE_BUILD,
  [EngineeringStepType.TEST]: EngineeringCapability.TEST_EXECUTION,
  [EngineeringStepType.PACKAGE]: EngineeringCapability.REVIEW_PACKAGE,
});

type StepRow = {
  id: string;
  stepType: string;
  status: string;
  causationId: string | null;
  metadata: unknown;
  startedAt: Date;
  finishedAt: Date | null;
};

export interface RedTeamEvidenceEntry {
  readonly stepType: string;
  readonly workflowStepRunId: string;
  readonly invocationId: string;
  readonly capabilityCode: string;
  readonly providerId: string;
  readonly outputReference: string;
  readonly policyDecisionReference: string;
  readonly revisionSha: string;
  readonly resultSummary?: Readonly<Record<string, unknown>>;
  readonly sideEffectSummary: Readonly<Record<string, unknown>>;
  readonly runtimeEvidence?: Readonly<Record<string, unknown>>;
}

export interface HumanReleaseBoundaryEvidence {
  readonly authority: 'HUMAN_EXPLICIT_ONLY';
  readonly agentRuntimeDisposition: 'NON_AGENT_STEP';
  readonly humanReleaseGate: Readonly<{ agentExecutable: false; capabilityCode: null }>;
  readonly releaseExecution: Readonly<{ agentExecutable: false; capabilityCode: null }>;
}

export interface RedTeamEvidenceManifest {
  readonly schemaVersion: typeof MANIFEST_VERSION;
  readonly workflowRunId: string;
  readonly redTeamStepRunId: string;
  readonly testedRevisionSha: string;
  readonly entries: readonly RedTeamEvidenceEntry[];
  readonly humanReleaseBoundary: HumanReleaseBoundaryEvidence;
  readonly manifestSha256: string;
}

@Injectable()
export class WorkflowRedTeamEvidenceHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executionPlan: WorkflowExecutionPlanService,
  ) {}

  async resolve(
    organizationId: string,
    workflowRunId: string,
    redTeamStepRunId: string,
  ): Promise<RedTeamEvidenceManifest> {
    const redTeam = await this.step(organizationId, workflowRunId, redTeamStepRunId);
    if (redTeam.stepType !== EngineeringStepType.RED_TEAM || redTeam.status !== 'READY' || !redTeam.causationId) {
      throw new ConflictException('RED_TEAM_EVIDENCE_LINEAGE_INVALID');
    }

    const packageStep = await this.predecessor(organizationId, workflowRunId, redTeam.causationId, [EngineeringStepType.PACKAGE]);
    const testStep = await this.predecessor(organizationId, workflowRunId, packageStep.causationId, [EngineeringStepType.TEST]);
    const changeStep = await this.predecessor(organizationId, workflowRunId, testStep.causationId, [EngineeringStepType.BUILD, EngineeringStepType.CORRECTION]);

    const change = await this.entry(organizationId, workflowRunId, changeStep, false);
    const test = await this.entry(organizationId, workflowRunId, testStep, true);
    const reviewPackage = await this.entry(organizationId, workflowRunId, packageStep, true);

    if (test.revisionSha !== reviewPackage.revisionSha) {
      throw new ConflictException('RED_TEAM_EVIDENCE_REVISION_MISMATCH');
    }

    const humanReleaseBoundary = this.humanReleaseBoundaryEvidence();
    const core = Object.freeze({
      schemaVersion: MANIFEST_VERSION,
      workflowRunId,
      redTeamStepRunId,
      testedRevisionSha: test.revisionSha,
      entries: Object.freeze([change, test, reviewPackage]),
      humanReleaseBoundary,
    });
    return Object.freeze({
      ...core,
      manifestSha256: createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex'),
    });
  }

  private async predecessor(
    organizationId: string,
    workflowRunId: string,
    stepRunId: string | null,
    allowedStepTypes: readonly EngineeringStepType[],
  ): Promise<StepRow> {
    if (!stepRunId) throw new ConflictException('RED_TEAM_EVIDENCE_LINEAGE_INCOMPLETE');
    const step = await this.step(organizationId, workflowRunId, stepRunId);
    if (step.status !== 'SUCCEEDED' || !allowedStepTypes.includes(step.stepType as EngineeringStepType)) {
      throw new ConflictException('RED_TEAM_EVIDENCE_LINEAGE_STALE');
    }
    return step;
  }

  private async step(organizationId: string, workflowRunId: string, stepRunId: string): Promise<StepRow> {
    const step = await this.prisma.workflowStepRun.findFirst({
      where: { id: stepRunId, organizationId, workflowRunId },
      select: { id: true, stepType: true, status: true, causationId: true, metadata: true, startedAt: true, finishedAt: true },
    });
    if (!step) throw new NotFoundException('RED_TEAM_EVIDENCE_STEP_NOT_FOUND');
    return step as StepRow;
  }

  private async entry(
    organizationId: string,
    workflowRunId: string,
    step: StepRow,
    requireSummary: boolean,
  ): Promise<RedTeamEvidenceEntry> {
    const capabilityCode = EXPECTED_CAPABILITY[step.stepType];
    if (!capabilityCode) throw new ConflictException('RED_TEAM_EVIDENCE_CAPABILITY_UNSUPPORTED');
    const metadata = this.record(step.metadata);
    if (metadata?.source !== 'WORKFLOW_AGENT_RUNTIME' || metadata.executionStatus !== AgentExecutionStatus.SUCCEEDED) {
      throw new ConflictException('RED_TEAM_EVIDENCE_STEP_METADATA_INVALID');
    }
    const executionEvidence = this.record(metadata.executionEvidence);
    const revision = this.record(executionEvidence?.revision);
    const invocationId = this.string(executionEvidence?.invocationId);
    const outputReference = this.string(executionEvidence?.outputReference);
    const revisionSha = this.gitSha(revision?.baseSha);
    const providerId = this.string(metadata.selectedProviderId);
    if (!invocationId || !outputReference || !revisionSha || !providerId || metadata.capabilityCode !== capabilityCode) {
      throw new ConflictException('RED_TEAM_EVIDENCE_STEP_PROJECTION_INCOMPLETE');
    }

    const resultSummary = this.record(executionEvidence?.resultSummary);
    const resultSummarySha = resultSummary ? this.sha(resultSummary.sha256) : null;
    if (requireSummary && (!resultSummary || !resultSummarySha || typeof resultSummary.content !== 'string')) {
      throw new ConflictException('RED_TEAM_EVIDENCE_RESULT_SUMMARY_MISSING');
    }

    const record = await this.prisma.governedExecutionRecord.findFirst({
      where: {
        id: invocationId,
        organizationId,
        workflowRunId,
        workflowStepRunId: step.id,
        capabilityCode,
        providerId,
        status: AgentExecutionStatus.SUCCEEDED,
      },
      select: {
        id: true,
        outputReference: true,
        policyDecisionReference: true,
        sideEffectSummary: true,
        usageMetadata: true,
      },
    });
    if (!record || record.outputReference !== outputReference || !record.policyDecisionReference) {
      throw new ConflictException('RED_TEAM_EVIDENCE_LEDGER_MISMATCH');
    }

    const usage = this.record(record.usageMetadata);
    const binding = this.record(usage?.governedEvidenceBinding);
    if (this.revisionSha(binding?.revisionReference) !== revisionSha) {
      throw new ConflictException('RED_TEAM_EVIDENCE_REVISION_BINDING_MISMATCH');
    }
    if (requireSummary && this.stdoutSha(binding?.stdoutSha256Reference) !== resultSummarySha) {
      throw new ConflictException('RED_TEAM_EVIDENCE_RESULT_BINDING_MISMATCH');
    }
    const runtimeEvidence = requireSummary
      ? this.runtimeEvidence(usage?.governedRuntimeEvidence, revisionSha, record.sideEffectSummary, step.stepType)
      : null;

    return Object.freeze({
      stepType: step.stepType,
      workflowStepRunId: step.id,
      invocationId,
      capabilityCode,
      providerId,
      outputReference,
      policyDecisionReference: record.policyDecisionReference,
      revisionSha,
      ...(requireSummary ? { resultSummary: Object.freeze({ ...resultSummary }) } : {}),
      sideEffectSummary: Object.freeze({ ...(this.record(record.sideEffectSummary) ?? {}) }),
      ...(runtimeEvidence ? { runtimeEvidence } : {}),
    });
  }

  private runtimeEvidence(
    value: unknown,
    revisionSha: string,
    sideEffectSummary: unknown,
    stepType: string,
  ): Readonly<Record<string, unknown>> {
    const evidence = this.record(value);
    const settling = this.record(evidence?.settling);
    const changedFiles = this.stringArray(settling?.changedFiles);
    const sideEffects = this.record(sideEffectSummary);
    const filesModified = this.stringArray(sideEffects?.filesModified);
    if (
      evidence?.workspaceDisposition !== 'CLEANED' ||
      evidence?.ephemeralMaterialDisposition !== 'REMOVED' ||
      !settling ||
      !this.string(settling.executionId) ||
      this.revisionSha(settling.revisionReference) !== revisionSha ||
      typeof settling.empty !== 'boolean' ||
      !this.patchSha(settling.patchSha256Reference) ||
      changedFiles === null ||
      filesModified === null ||
      JSON.stringify(changedFiles) !== JSON.stringify(filesModified)
    ) {
      throw new ConflictException('RED_TEAM_EVIDENCE_RUNTIME_POSTCONDITIONS_INVALID');
    }
    const identity = this.record(evidence.providerIdentityPostcondition);
    if (identity?.enforced !== true || identity?.passed !== true) {
      throw new ConflictException('RED_TEAM_EVIDENCE_PROVIDER_IDENTITY_INVALID');
    }
    const flight001Acceptance = this.record(evidence.flight001Acceptance);
    if (
      stepType === EngineeringStepType.TEST &&
      (flight001Acceptance?.checked !== true || flight001Acceptance?.passed !== true)
    ) {
      throw new ConflictException('RED_TEAM_EVIDENCE_FLIGHT_001_ACCEPTANCE_INVALID');
    }
    return Object.freeze({
      workspaceDisposition: 'CLEANED',
      ephemeralMaterialDisposition: 'REMOVED',
      settling: Object.freeze({ ...settling, changedFiles: Object.freeze([...changedFiles]) }),
      providerIdentityPostcondition: Object.freeze({ ...identity }),
      ...(flight001Acceptance
        ? { flight001Acceptance: Object.freeze({ ...flight001Acceptance }) }
        : {}),
      ledgerStatus: AgentExecutionStatus.SUCCEEDED,
    });
  }

  private humanReleaseBoundaryEvidence(): HumanReleaseBoundaryEvidence {
    if (
      this.executionPlan.capabilityForStep(EngineeringStepType.HUMAN_RELEASE_GATE) !== null ||
      this.executionPlan.capabilityForStep(EngineeringStepType.RELEASE_EXECUTION) !== null
    ) {
      throw new ConflictException('RED_TEAM_EVIDENCE_HUMAN_RELEASE_BOUNDARY_INVALID');
    }
    return Object.freeze({
      authority: 'HUMAN_EXPLICIT_ONLY' as const,
      agentRuntimeDisposition: 'NON_AGENT_STEP' as const,
      humanReleaseGate: Object.freeze({ agentExecutable: false as const, capabilityCode: null }),
      releaseExecution: Object.freeze({ agentExecutable: false as const, capabilityCode: null }),
    });
  }

  private stringArray(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > 64) return null;
    const result: string[] = [];
    for (const item of value) {
      const normalized = this.string(item);
      if (!normalized) return null;
      result.push(normalized);
    }
    return result;
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }
  private string(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= 2_048 ? value : null;
  }
  private gitSha(value: unknown): string | null {
    return typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value) ? value : null;
  }
  private sha(value: unknown): string | null {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : null;
  }
  private revisionSha(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^gov:\/\/revision\/([a-f0-9]{40,64})$/u.exec(value);
    return match?.[1] ?? null;
  }
  private stdoutSha(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^gov:\/\/evidence\/stdout-sha256\/([a-f0-9]{64})$/u.exec(value);
    return match?.[1] ?? null;
  }
  private patchSha(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^gov:\/\/evidence\/patch-sha256\/([a-f0-9]{64})$/u.exec(value);
    return match?.[1] ?? null;
  }
}
