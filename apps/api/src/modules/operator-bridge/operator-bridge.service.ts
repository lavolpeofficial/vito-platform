import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  OperatorTask,
  OperatorTaskStatus as PrismaOperatorTaskStatus,
  Prisma,
} from '@prisma/client';
import {
  AgentExecutionStatus,
  OperatorTaskError,
  OperatorTaskStatus,
} from '@vito/contracts';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AgentWorkforceService } from '../agent-workforce/agent-workforce.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitOperatorTaskDto } from './dto/submit-operator-task.dto';
import { computeRequestFingerprint } from './idempotency';
import {
  OPERATOR_BRIDGE_CONFIG,
  OperatorBridgeConfig,
} from './operator-bridge.config';

const MAX_SAFE_TEXT_LENGTH = 2000;
const MAX_CHANGED_FILES = 4096;
const REDACTED = '[REDACTED]';
const OPERATOR_TASK_ENTITY = 'OperatorTask';

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN\s+(RSA\s+)?(EC\s+)?PRIVATE\s+KEY-----[\s\S]*?(-----END\s+([A-Z0-9]+\s+)?PRIVATE\s+KEY-----|$)/,
  /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/,
  /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/,
  /\beyJhbGciOi[A-Za-z0-9._\-]+\.eyJ[A-Za-z0-9._\-]+/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[posr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[bpsa]-[A-Za-z0-9\-]{10,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
];

export interface SubmitOperatorTaskResponse {
  readonly taskId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly status: OperatorTaskStatus;
  readonly routingDecisionId: string | null;
}

export interface OperatorTaskResult {
  readonly taskId: string;
  readonly requestId: string;
  readonly status: OperatorTaskStatus;
  readonly correlationId: string;
  readonly workflowRunId: string;
  readonly workflowStepRunId: string;
  readonly invocationId?: string;
  readonly executionId?: string;
  readonly provider?: { readonly providerCode: string; readonly displayName: string };
  readonly capabilityCode: string;
  readonly prompt: string | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly changedFiles?: readonly string[];
  readonly patch: string | null;
  readonly error?: OperatorTaskError;
  readonly timing?: {
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly durationMs?: number;
  };
  readonly workspaceDisposition?: 'CLEANED';
  readonly reviewRequired: boolean;
  readonly sensitivePayloadAvailable: boolean;
  readonly sensitivePayloadExpiresAt: string;
  readonly sensitivePayloadDeletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type AgentDispatchResult = Awaited<ReturnType<AgentWorkforceService['dispatch']>>;

interface DispatchClaim {
  readonly task: OperatorTask;
  readonly ownsDispatch: boolean;
}

interface TerminalUpdate {
  readonly status: PrismaOperatorTaskStatus;
  readonly routingDecisionId: string | null;
  readonly selectedProviderId: string | null;
  readonly providerCode: string | null;
  readonly invocationId: string | null;
  readonly executionId: string | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly changedFiles: readonly string[] | null;
  readonly patch: string | null;
  readonly errorReason: string | null;
  readonly errorMessage: string | null;
  readonly errorRetryable: boolean | null;
  readonly reviewRequired: boolean;
  readonly workspaceDisposition: 'CLEANED' | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date;
  readonly durationMs: number | null;
}

interface LockedPayloadState {
  readonly sensitivePayloadAvailable: boolean;
  readonly sensitivePayloadExpiresAt: Date;
  readonly sensitivePayloadDeletedAt: Date | null;
  readonly databaseNow: Date;
}

@Injectable()
export class OperatorBridgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentWorkforceService: AgentWorkforceService,
    private readonly auditService: AuditService,
    @Inject(OPERATOR_BRIDGE_CONFIG) private readonly config: OperatorBridgeConfig,
  ) {}

  async submitTask(
    organizationId: string,
    userId: string,
    request: SubmitOperatorTaskDto,
  ): Promise<SubmitOperatorTaskResponse> {
    const fingerprint = computeRequestFingerprint(request);
    const key = { organizationId, requestId: request.requestId };
    const identity = {
      id: randomUUID(),
      correlationId: randomUUID(),
      workflowRunId: randomUUID(),
      workflowStepRunId: randomUUID(),
    };
    const createdAt = new Date();
    const sensitivePayloadExpiresAt = new Date(
      createdAt.getTime() + this.config.sensitivePayloadTtlHours * 60 * 60 * 1000,
    );

    let claim: DispatchClaim;
    try {
      claim = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.operatorTask.findUnique({
          where: { organizationId_requestId: key },
        });
        if (existing) return this.resolveExisting(existing, fingerprint);

        const task = await tx.operatorTask.create({
          data: {
            ...identity,
            ...key,
            userId,
            requestFingerprint: fingerprint,
            capabilityCode: request.capabilityCode,
            prompt: request.prompt,
            assuranceLevel: request.assuranceLevel ?? null,
            status: PrismaOperatorTaskStatus.DISPATCHING,
            maxDurationMs: request.budget?.maxDurationMs ?? null,
            maxTokens: request.budget?.maxTokens ?? null,
            maxCostMinorUnits: request.budget?.maxCostMinorUnits ?? null,
            sensitivePayloadAvailable: true,
            sensitivePayloadExpiresAt,
            createdAt,
          },
        });
        await this.auditService.record(
          {
            organizationId,
            actorType: 'USER',
            actorId: userId,
            action: 'OPERATOR_TASK_CREATED',
            entityType: OPERATOR_TASK_ENTITY,
            entityId: task.id,
            metadata: this.baseAuditMetadata(task),
          },
          tx,
        );
        return { task, ownsDispatch: true };
      });
    } catch (error) {
      if (!isOperatorRequestKeyConflict(error)) {
        if (error instanceof HttpException) throw error;
        throw new InternalServerErrorException('OPERATOR_TASK_CLAIM_PERSISTENCE_FAILED');
      }
      let existing: OperatorTask | null;
      try {
        existing = await this.prisma.operatorTask.findUnique({
          where: { organizationId_requestId: key },
        });
      } catch {
        throw new InternalServerErrorException('OPERATOR_TASK_CLAIM_PERSISTENCE_FAILED');
      }
      if (!existing) {
        throw new InternalServerErrorException('OPERATOR_TASK_CLAIM_PERSISTENCE_FAILED');
      }
      claim = this.resolveExisting(existing, fingerprint);
    }

    if (!claim.ownsDispatch) return this.toSubmitResponse(claim.task);

    const dispatchStartedAt = new Date();
    let terminal: TerminalUpdate;
    try {
      const result = await this.agentWorkforceService.dispatch(
        this.toAgentDispatchRequest(claim.task),
      );
      terminal = this.mapDispatchResult(result);
    } catch (error) {
      terminal = this.mapDispatchFailure(error, dispatchStartedAt);
    }

    const persisted = await this.persistTerminalResult(claim.task, terminal);
    return this.toSubmitResponse(persisted);
  }

  async getTask(organizationId: string, taskId: string): Promise<OperatorTaskResult> {
    const task = await this.prisma.operatorTask.findFirst({
      where: { id: taskId, organizationId },
    });
    if (!task) throw new NotFoundException('Operator task not found.');
    return this.toTaskResult(task);
  }

  private resolveExisting(task: OperatorTask, fingerprint: string): DispatchClaim {
    if (task.requestFingerprint !== fingerprint) {
      throw new ConflictException('OPERATOR_IDEMPOTENCY_CONFLICT');
    }
    return { task, ownsDispatch: false };
  }

  private toAgentDispatchRequest(task: OperatorTask) {
    if (task.prompt === null) {
      throw new InternalServerErrorException('OPERATOR_TASK_PAYLOAD_UNAVAILABLE');
    }
    const executionBudget =
      task.maxDurationMs !== null ||
      task.maxTokens !== null ||
      task.maxCostMinorUnits !== null
        ? {
            ...(task.maxDurationMs !== null ? { maxDurationMs: task.maxDurationMs } : {}),
            ...(task.maxTokens !== null ? { maxTokens: task.maxTokens } : {}),
            ...(task.maxCostMinorUnits !== null
              ? { maxCostMinorUnits: task.maxCostMinorUnits }
              : {}),
          }
        : undefined;

    return {
      organizationId: task.organizationId,
      workflowRunId: task.workflowRunId,
      workflowStepRunId: task.workflowStepRunId,
      capabilityCode: task.capabilityCode,
      prompt: task.prompt,
      assuranceLevel: task.assuranceLevel ?? undefined,
      correlationId: task.correlationId,
      executionBudget,
    };
  }

  private mapDispatchResult(result: AgentDispatchResult): TerminalUpdate {
    const execution = result.execution;
    const metadata = isRecord(execution.providerExecutionMetadata)
      ? execution.providerExecutionMetadata
      : {};
    const settling = isRecord(metadata.governedResultSettling)
      ? metadata.governedResultSettling
      : {};
    const status =
      execution.status === AgentExecutionStatus.SUCCEEDED
        ? PrismaOperatorTaskStatus.COMPLETED
        : execution.status === AgentExecutionStatus.POLICY_BLOCKED
          ? PrismaOperatorTaskStatus.HUMAN_GATE
          : PrismaOperatorTaskStatus.FAILED;
    const error = execution.normalizedError;

    return {
      status,
      routingDecisionId: result.routingDecisionId,
      selectedProviderId: result.selectedProviderId,
      providerCode: result.selectedProviderCode,
      invocationId: execution.invocationId,
      executionId: readString(settling.executionId, true),
      stdout: readString(metadata.stdout, true),
      stderr: readString(metadata.stderr, true),
      changedFiles: readStringArray(settling.changedFiles, true),
      // The governed change-set is integrity-bearing. Upstream capture limits are authoritative;
      // the bridge persists the returned patch exactly and only retention may delete it.
      patch: readString(settling.patch),
      errorReason:
        (error?.reason !== undefined ? redactSensitiveText(error.reason) : null) ??
        (status === PrismaOperatorTaskStatus.COMPLETED
          ? null
          : `AGENT_EXECUTION_${execution.status}`),
      errorMessage:
        error?.message !== undefined
          ? redactSensitiveText(error.message)
          : status === PrismaOperatorTaskStatus.COMPLETED
            ? null
            : 'Governed execution did not complete successfully.',
      errorRetryable: error?.retryable ?? (status === PrismaOperatorTaskStatus.COMPLETED ? null : false),
      reviewRequired: status === PrismaOperatorTaskStatus.HUMAN_GATE,
      workspaceDisposition: metadata.workspaceDisposition === 'CLEANED' ? 'CLEANED' : null,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      durationMs: execution.durationMs,
    };
  }

  private mapDispatchFailure(error: unknown, startedAt: Date): TerminalUpdate {
    const completedAt = new Date();
    const mapped = mapThrownDispatchError(error);
    return {
      status: PrismaOperatorTaskStatus.FAILED,
      routingDecisionId: mapped.routingDecisionId,
      selectedProviderId: null,
      providerCode: null,
      invocationId: null,
      executionId: null,
      stdout: null,
      stderr: null,
      changedFiles: null,
      patch: null,
      errorReason: mapped.reason,
      errorMessage: mapped.message,
      errorRetryable: mapped.retryable,
      reviewRequired: false,
      workspaceDisposition: null,
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    };
  }

  private async persistTerminalResult(
    claim: OperatorTask,
    terminal: TerminalUpdate,
  ): Promise<OperatorTask> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<LockedPayloadState[]>`
          SELECT
            "sensitivePayloadAvailable",
            "sensitivePayloadExpiresAt",
            "sensitivePayloadDeletedAt",
            CURRENT_TIMESTAMP AS "databaseNow"
          FROM "operator_tasks"
          WHERE "id" = ${claim.id}
            AND "organizationId" = ${claim.organizationId}
            AND "status" = 'DISPATCHING'::"OperatorTaskStatus"
          FOR UPDATE
        `;
        const payloadState = rows[0];
        if (!payloadState) {
          throw new InternalServerErrorException('OPERATOR_TASK_TERMINAL_PERSISTENCE_FAILED');
        }

        const payloadExpired =
          !payloadState.sensitivePayloadAvailable ||
          payloadState.sensitivePayloadExpiresAt.getTime() <= payloadState.databaseNow.getTime();
        const provider = terminal.selectedProviderId
          ? await tx.agentProvider.findFirst({
              where: {
                id: terminal.selectedProviderId,
                organizationId: claim.organizationId,
              },
              select: { displayName: true },
            })
          : null;
        const task = await tx.operatorTask.update({
          where: { id: claim.id },
          data: {
            status: terminal.status,
            invocationId: terminal.invocationId,
            executionId: terminal.executionId,
            routingDecisionId: terminal.routingDecisionId,
            providerCode: terminal.providerCode,
            providerName: provider?.displayName ?? null,
            changedFiles:
              terminal.changedFiles === null
                ? Prisma.DbNull
                : ([...terminal.changedFiles] as Prisma.InputJsonValue),
            errorReason: terminal.errorReason,
            errorMessage: terminal.errorMessage,
            errorRetryable: terminal.errorRetryable,
            reviewRequired: terminal.reviewRequired,
            workspaceDisposition: terminal.workspaceDisposition,
            startedAt: terminal.startedAt,
            completedAt: terminal.completedAt,
            durationMs: terminal.durationMs,
            ...(payloadExpired
              ? {
                  prompt: null,
                  patch: null,
                  stdout: null,
                  stderr: null,
                  sensitivePayloadAvailable: false,
                  sensitivePayloadDeletedAt:
                    payloadState.sensitivePayloadDeletedAt ?? payloadState.databaseNow,
                }
              : {
                  patch: terminal.patch,
                  stdout: terminal.stdout,
                  stderr: terminal.stderr,
                }),
          },
        });
        await this.auditService.record(
          {
            organizationId: task.organizationId,
            actorType: 'USER',
            actorId: task.userId,
            action:
              task.status === PrismaOperatorTaskStatus.COMPLETED
                ? 'OPERATOR_TASK_COMPLETED'
                : task.status === PrismaOperatorTaskStatus.HUMAN_GATE
                  ? 'OPERATOR_TASK_HUMAN_GATE_REQUIRED'
                  : 'OPERATOR_TASK_FAILED',
            entityType: OPERATOR_TASK_ENTITY,
            entityId: task.id,
            metadata: {
              ...this.baseAuditMetadata(task),
              routingDecisionId: task.routingDecisionId,
              invocationId: task.invocationId,
              executionId: task.executionId,
              providerCode: task.providerCode,
              durationMs: task.durationMs,
              errorReason: task.errorReason,
              errorRetryable: task.errorRetryable,
              changedFileCount: terminal.changedFiles?.length ?? 0,
              patchBytes: terminal.patch === null ? 0 : Buffer.byteLength(terminal.patch, 'utf8'),
            },
          },
          tx,
        );
        return task;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('OPERATOR_TASK_TERMINAL_PERSISTENCE_FAILED');
    }
  }

  private baseAuditMetadata(task: OperatorTask): Record<string, unknown> {
    return {
      requestId: task.requestId,
      correlationId: task.correlationId,
      workflowRunId: task.workflowRunId,
      workflowStepRunId: task.workflowStepRunId,
      capabilityCode: task.capabilityCode,
      status: task.status,
    };
  }

  private toSubmitResponse(task: OperatorTask): SubmitOperatorTaskResponse {
    return {
      taskId: task.id,
      requestId: task.requestId,
      correlationId: task.correlationId,
      status: task.status as OperatorTaskStatus,
      routingDecisionId: task.routingDecisionId,
    };
  }

  private toTaskResult(task: OperatorTask): OperatorTaskResult {
    const changedFiles = readStringArray(task.changedFiles, true);
    const hasTiming = task.startedAt !== null || task.completedAt !== null || task.durationMs !== null;
    return {
      taskId: task.id,
      requestId: task.requestId,
      status: task.status as OperatorTaskStatus,
      correlationId: task.correlationId,
      workflowRunId: task.workflowRunId,
      workflowStepRunId: task.workflowStepRunId,
      ...(task.invocationId !== null ? { invocationId: task.invocationId } : {}),
      ...(task.executionId !== null ? { executionId: task.executionId } : {}),
      ...(task.providerCode !== null && task.providerName !== null
        ? { provider: { providerCode: task.providerCode, displayName: task.providerName } }
        : {}),
      capabilityCode: task.capabilityCode,
      prompt: task.prompt,
      stdout: task.stdout,
      stderr: task.stderr,
      ...(changedFiles !== null ? { changedFiles } : {}),
      patch: task.patch,
      ...(task.errorReason !== null && task.errorMessage !== null
        ? {
            error: {
              reason: task.errorReason,
              message: task.errorMessage,
              retryable: task.errorRetryable ?? false,
            },
          }
        : {}),
      ...(hasTiming
        ? {
            timing: {
              ...(task.startedAt !== null ? { startedAt: task.startedAt.toISOString() } : {}),
              ...(task.completedAt !== null ? { completedAt: task.completedAt.toISOString() } : {}),
              ...(task.durationMs !== null ? { durationMs: task.durationMs } : {}),
            },
          }
        : {}),
      ...(task.workspaceDisposition === 'CLEANED'
        ? { workspaceDisposition: 'CLEANED' as const }
        : {}),
      reviewRequired: task.reviewRequired,
      sensitivePayloadAvailable: task.sensitivePayloadAvailable,
      sensitivePayloadExpiresAt: task.sensitivePayloadExpiresAt.toISOString(),
      sensitivePayloadDeletedAt: task.sensitivePayloadDeletedAt?.toISOString() ?? null,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }
}

export function isOperatorRequestKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return (
      target.length === 2 &&
      target[0] === 'organizationId' &&
      target[1] === 'requestId'
    );
  }
  return target === 'operator_tasks_organizationId_requestId_key';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, redact = false): string | null {
  if (typeof value !== 'string') return null;
  return redact ? redactSensitiveText(value) : value;
}

function readStringArray(value: unknown, sanitize = false): readonly string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return null;
  return Object.freeze(
    value
      .slice(0, MAX_CHANGED_FILES)
      .map((entry) => (sanitize ? redactSensitiveText(entry) : entry)),
  );
}

function redactSensitiveText(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, `${pattern.flags}g`), REDACTED);
  }
  return redacted.length > MAX_SAFE_TEXT_LENGTH
    ? `${redacted.slice(0, MAX_SAFE_TEXT_LENGTH)}...`
    : redacted;
}

function mapThrownDispatchError(error: unknown): {
  readonly reason: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly routingDecisionId: string | null;
} {
  let code: string | null = null;
  let message = 'Governed dispatch failed.';
  let routingDecisionId: string | null = null;

  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') {
      message = response;
    } else if (isRecord(response)) {
      code = readString(response.code);
      const responseMessage = response.message;
      if (typeof responseMessage === 'string') message = responseMessage;
      routingDecisionId = readString(response.routingDecisionId);
    }
  }

  const reason =
    code ??
    (error instanceof HttpException && error.getStatus() === 400
      ? 'OPERATOR_DISPATCH_INPUT_INVALID'
      : 'OPERATOR_DISPATCH_FAILED');
  return {
    reason,
    message: redactSensitiveText(message),
    retryable: reason === 'NO_ELIGIBLE_AGENT_PROVIDER',
    routingDecisionId,
  };
}
