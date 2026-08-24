import { Inject, Injectable, Logger } from '@nestjs/common';
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

/**
 * Trust-Origin-Diskriminator des internen Runtime-Eingangs (B2c).
 *
 * Der organizationId-Mandant kommt NIE aus externen Request-Feldern: Nur
 * serverseitiger Runtime-Code konstruiert TrustedGovernedWorkspaceFileOperation
 * mit trustOrigin=SERVER_RUNTIME. Der Facade-Eingang verweigert jedes Objekt
 * ohne diesen Diskriminator (GOVERNED_RUNTIME_UNTRUSTED_CONTEXT), bevor
 * irgendeine Persistenz oder Ausführung erfolgt. Der spätere HTTP/TenantContext-
 * Anschluss (B2d) bindet dieselbe Struktur an den authentifizierten Tenant.
 */
export const TRUSTED_RUNTIME_ORIGIN = 'SERVER_RUNTIME' as const;

export const GOVERNED_RUNTIME_PURPOSE_CODE = 'INTERNAL_WORKSPACE_FILE_TOOL' as const;

const MAX_CONTENT_LENGTH_BYTES = 1024 * 1024;
const MAX_RELATIVE_PATH_LENGTH = 512;

const FILE_MUTATION_ACTIONS: readonly string[] = ['CREATE_FILE', 'WRITE_FILE'];

export interface TrustedGovernedWorkspaceFileOperation {
  /** Server-seitiger Herkunfts-Nachweis. Externe DTOs haben dieses Feld nie. */
  readonly trustOrigin: typeof TRUSTED_RUNTIME_ORIGIN;
  /** Trusted, serverseitig abgeleiteter Mandant (niemals caller-authoritativ). */
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
  /** Optionale kontrollierte Korrelation (sonst Envelope-Id). */
  readonly correlationId?: string;
  /**
   * Optionale trusted Workflow-Identität für Retry-Szenarien. Die logische
   * Operationsidentität von EO-01.5 schließt run/step ein — nur wer dieselbe
   * Identität erneut vorlegt, trifft denselben logicalOperationKey (DUPLICATE-
   * Schutz). Ohne Angabe wird eine frische Identität erzeugt.
   */
  readonly workflowRunId?: string;
  readonly workflowStepRunId?: string;
}

@Injectable()
export class GovernedRuntimeService {
  private readonly logger = new Logger(GovernedRuntimeService.name);

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
        // Nicht-autoritativer Hinweis (nur strukturelle Gültigkeit gefordert);
        // autoritativ bleibt ausschließlich der trusted ProfileResolver.
        executionProfile: ExecutionProfile.BUILDER,
        executionBudget: { maxDurationMs: 30_000 },
        requestedAction: input.requestedAction as ExecutionAction,
        requestedPath: input.relativePath,
        requestedCommand: input.command,
        governedInputPayload:
          input.content !== undefined ? { content: input.content } : undefined,
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
      // Pre-boundary-Vertrauensfehler (PROVIDER_UNAVAILABLE, ORGANIZATION_MISMATCH,
      // CAPABILITY_NOT_SUPPORTED, PROVIDER_NOT_ELIGIBLE, CREDENTIAL_INJECTION_FAILED,
      // EXECUTABLE_NOT_TRUSTED, MALFORMED_INVOCATION, ...) werfen laut EO-01.5
      // bewusst KEIN normalisiertes Ergebnis. Der Envelope wird serverseitig
      // als FAILED terminiert und der Fehler unverändert propagiert — es wird
      // kein alternativer Ergebnisumschlag erfunden.
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

  /**
   * Minimale serverseitige Workspace-Bereitstellung: der beim Start
   * validierte absolute Root plus der deterministische SHA-256-Organisations-
   * ordner (B2b-Helper) werden idempotent erzeugt. Keine Pfadanteile aus
   * Eingaben fließen hier ein.
   */
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
      return;
    }

    // GIT_PUSH trägt keine modellierten Ziel-Felder; nur Datei-Aktionen
    // verlangen einen gebundenen relativen Pfad.
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
