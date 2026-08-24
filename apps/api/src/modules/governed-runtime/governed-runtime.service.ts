import { Inject, Injectable } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AgentExecutionStatus,
  ExecutionAction,
  ExecutionProfile,
  GovernedCapabilityInvocationResult,
} from '@vito/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GovernedInvocationServiceImpl } from '../governed-invocation/governed-invocation.service';
import { mapGovernedExecutionResultToRecordInput } from './persistence/governed-persistence.mappers';
import { governedOrgDirectoryName } from './resolvers/governed-workspace.resolvers';
import { GOVERNED_WORKSPACE_ROOT } from './governed-runtime.tokens';

export const TRUSTED_RUNTIME_ORIGIN = 'SERVER_RUNTIME' as const;
export const GOVERNED_RUNTIME_PURPOSE_CODE = 'INTERNAL_WORKSPACE_FILE_TOOL' as const;

const MAX_CONTENT_LENGTH_BYTES = 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 512;
const FILE_MUTATION_ACTIONS: readonly string[] = ['CREATE_FILE', 'WRITE_FILE'];

export interface TrustedGovernedWorkspaceFileOperation {
  readonly trustOrigin: typeof TRUSTED_RUNTIME_ORIGIN;
  readonly organizationId: string;
  readonly providerId: string;
  readonly capabilityCode: string;
  readonly requestedAction:
    | 'CREATE_FILE'
    | 'WRITE_FILE'
    | 'READ_FILE'
    | 'RUN_COMMAND'
    | 'GIT_PUSH';
  readonly relativePath?: string;
  readonly content?: string;
  readonly command?: string;
  /**
   * Trusted, server-side payload for governed adapters. This is intentionally
   * not an external DTO. For headless local agents it may contain bounded
   * `args` and `prompt` fields; the adapter validates its own payload schema.
   */
  readonly governedInputPayload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly workflowRunId?: string;
  readonly workflowStepRunId?: string;
}

@Injectable()
export class GovernedRuntimeService {
  constructor(
    private readonly invocationService: GovernedInvocationServiceImpl,
    private readonly prisma: PrismaService,
    @Inject(GOVERNED_WORKSPACE_ROOT) private readonly workspaceRoot: string,
  ) {}

  async executeWorkspaceFileOperation(
    input: TrustedGovernedWorkspaceFileOperation,
  ): Promise<GovernedCapabilityInvocationResult> {
    this.assertTrustedOperation(input);
    this.ensureGovernedOrgWorkspace(input.organizationId);

    const envelope = await this.prisma.governedOperationEnvelope.create({
      data: {
        organizationId: input.organizationId,
        purposeCode: GOVERNED_RUNTIME_PURPOSE_CODE,
        correlationId: input.correlationId ?? null,
        status: 'PENDING',
      },
    });

    try {
      const result = await this.invocationService.invoke({
        invocationId: randomUUID(),
        organizationId: input.organizationId,
        workflowRunId: input.workflowRunId ?? envelope.id,
        workflowStepRunId: input.workflowStepRunId ?? randomUUID(),
        correlationId: input.correlationId ?? envelope.id,
        capabilityCode: input.capabilityCode,
        providerId: input.providerId,
        executionProfile: ExecutionProfile.BUILDER,
        executionBudget: { maxDurationMs: 30_000 },
        requestedAction: input.requestedAction as ExecutionAction,
        requestedPath: input.relativePath,
        requestedCommand: input.command,
        governedInputPayload:
          input.content !== undefined
            ? { content: input.content }
            : input.governedInputPayload,
        requestedAt: new Date(),
      });

      await this.persistExecutionRecord(result, envelope.id);

      await this.prisma.governedOperationEnvelope.update({
        where: { id: envelope.id },
        data: {
          status:
            result.status === AgentExecutionStatus.SUCCEEDED ? 'COMPLETED' : 'FAILED',
        },
      });

      return result;
    } catch (error) {
      await this.prisma.governedOperationEnvelope.update({
        where: { id: envelope.id },
        data: { status: 'FAILED' },
      });
      throw error;
    }
  }

  private async persistExecutionRecord(
    result: GovernedCapabilityInvocationResult,
    envelopeId: string,
  ): Promise<void> {
    const recordInput = mapGovernedExecutionResultToRecordInput(result);
    const json = (value: Record<string, unknown> | null) =>
      value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

    await this.prisma.governedExecutionRecord.create({
      data: {
        ...recordInput,
        status: recordInput.status as AgentExecutionStatus,
        artifactReferences:
          (recordInput.artifactReferences as string[] | null) ?? Prisma.JsonNull,
        normalizedError: json(recordInput.normalizedError),
        sideEffectSummary: json(recordInput.sideEffectSummary),
        usageMetadata: json(recordInput.usageMetadata),
        envelopeId,
      },
    });
  }

  private ensureGovernedOrgWorkspace(organizationId: string): void {
    const orgDir = join(this.workspaceRoot, 'orgs', governedOrgDirectoryName(organizationId));
    mkdirSync(orgDir, { recursive: true });
  }

  private assertTrustedOperation(input: TrustedGovernedWorkspaceFileOperation): void {
    if (
      !input ||
      (input as { trustOrigin?: unknown }).trustOrigin !== TRUSTED_RUNTIME_ORIGIN
    ) {
      throw new Error(
        'GOVERNED_RUNTIME_UNTRUSTED_CONTEXT: Governed runtime entry requires a trusted server-side operation context',
      );
    }

    if (!input.organizationId || !input.providerId || !input.capabilityCode) {
      throw new Error('GOVERNED_RUNTIME_MALFORMED_OPERATION: Missing required identifiers');
    }

    if (typeof input.organizationId !== 'string' || typeof input.providerId !== 'string') {
      throw new Error('GOVERNED_RUNTIME_MALFORMED_OPERATION: Identifier types invalid');
    }

    const isKnownAction =
      FILE_MUTATION_ACTIONS.includes(input.requestedAction) ||
      input.requestedAction === 'READ_FILE' ||
      input.requestedAction === 'RUN_COMMAND' ||
      input.requestedAction === 'GIT_PUSH';

    if (!isKnownAction) {
      throw new Error(
        `GOVERNED_RUNTIME_MALFORMED_OPERATION: Unsupported requested action ${String(input.requestedAction)}`,
      );
    }

    if (input.requestedAction === 'RUN_COMMAND') {
      if (typeof input.command !== 'string' || input.command.length === 0) {
        throw new Error(
          'GOVERNED_RUNTIME_MALFORMED_OPERATION: RUN_COMMAND requires a command',
        );
      }
      if (input.content !== undefined) {
        throw new Error(
          'GOVERNED_RUNTIME_MALFORMED_OPERATION: RUN_COMMAND must use governedInputPayload, not file content',
        );
      }
      return;
    }

    if (input.requestedAction === 'GIT_PUSH') {
      return;
    }

    if (
      typeof input.relativePath !== 'string' ||
      input.relativePath.length === 0 ||
      input.relativePath.length > MAX_RELATIVE_PATH_LENGTH
    ) {
      throw new Error(
        'GOVERNED_RUNTIME_MALFORMED_OPERATION: relativePath must be a non-empty bounded string',
      );
    }

    if (input.requestedAction === 'READ_FILE') {
      return;
    }

    if (
      typeof input.content !== 'string' ||
      Buffer.byteLength(input.content, 'utf8') > MAX_CONTENT_LENGTH_BYTES
    ) {
      throw new Error(
        'GOVERNED_RUNTIME_MALFORMED_OPERATION: content must be a string within the governed size bound',
      );
    }
  }
}
