import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { mapClaimRowToGovernedClaim } from './governed-persistence.mappers';
import type {
  GovernedInvocationClaimResult,
  GovernedInvocationClaimState,
  GovernedInvocationIdempotencyStore,
} from '@vito/contracts';

/**
 * Fehlgeschlagene Eigentümer-gebundene Claim-Fortschreibung.
 *
 * markCompleted() schreibt ausschließlich dem Besitzer zu; jede andere
 * Kombination (fremder Attempt, unbekannter Schlüssel, bereits
 * abgeschlossener Claim) wird lautstark abgelehnt — ein Claim wird nie
 * freigegeben oder zurückgesetzt.
 */
export class GovernedClaimCompletionRejectedError extends Error {
  constructor(logicalOperationKey: string, invocationId: string) {
    super(
      `GOVERNED_IDEMPOTENCY_CLAIM_COMPLETION_REJECTED: invocation ${invocationId} ` +
        `does not own an IN_PROGRESS claim for logical operation ${logicalOperationKey}`,
    );
    this.name = 'GovernedClaimCompletionRejectedError';
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * PostgreSQL-geführter Idempotenz-Speicher für governed Invocations
 * (EO-01.5 Phase 3H.1, B2a).
 *
 * Konkurrenz-Korrektheit kommt ausschließlich aus der Datenbank:
 * - UNIQUE(logicalOperationKey): atomares claim-or-inspect; der erste
 *   Insert wird Besitzer, jeder weitere Versuch auf demselben logischen
 *   Vorgang erhält DUPLICATE mit Besitzer-Evidenz.
 * - UNIQUE(invocationId): die Attempt-Identität ist global einmalig;
 *   dieselbe invocationId unter einem ANDEREN logischen Schlüssel ergibt
 *   CONTEXT_CONFLICT (Attacker-Reuse einer Attempt-Identität).
 *
 * Kein In-Process-Mutex, kein prozesslokaler Zustand — zwei
 * Store-Instanzen über derselben Datenbank sehen dieselben Claims.
 * Es gibt bewusst KEINEN Release-Pfad.
 */
@Injectable()
export class PrismaGovernedIdempotencyStore implements GovernedInvocationIdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async claim(
    logicalOperationKey: string,
    invocationId: string,
    contextFingerprint: string,
  ): Promise<GovernedInvocationClaimResult> {
    try {
      const row = await this.prisma.governedInvocationClaim.create({
        data: {
          logicalOperationKey,
          invocationId,
          contextFingerprint,
        },
      });
      return { outcome: 'CLAIMED', claim: mapClaimRowToGovernedClaim(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // Autorität ist ausschließlich die Datenbank: Disambiguierung via Reads.
      const existingForKey = await this.prisma.governedInvocationClaim.findUnique({
        where: { logicalOperationKey },
      });

      if (existingForKey && existingForKey.invocationId === invocationId) {
        // Derselbe Attempt wiederholt denselben logischen Vorgang: DUPLICATE
        // mit sich selbst als Besitzer-Evidenz — kein stillschweigender
        // Autoritäts-Neubezug.
        return { outcome: 'DUPLICATE', existing: mapClaimRowToGovernedClaim(existingForKey) };
      }

      const identityRow = await this.prisma.governedInvocationClaim.findFirst({
        where: { invocationId },
      });
      if (identityRow && identityRow.logicalOperationKey !== logicalOperationKey) {
        return { outcome: 'CONTEXT_CONFLICT', existingInvocationId: invocationId };
      }

      if (existingForKey) {
        return { outcome: 'DUPLICATE', existing: mapClaimRowToGovernedClaim(existingForKey) };
      }

      // Unerwarteter Zustand (z.B. Constraint-Verletzung ohne lesbares
      // Gegenstück): niemals still CLAIMED vortäuschen — fail closed.
      throw error;
    }
  }

  async markCompleted(
    logicalOperationKey: string,
    invocationId: string,
    state: GovernedInvocationClaimState,
  ): Promise<void> {
    const result = await this.prisma.governedInvocationClaim.updateMany({
      where: {
        logicalOperationKey,
        invocationId,
        state: 'IN_PROGRESS',
      },
      data: { state },
    });
    if (result.count !== 1) {
      throw new GovernedClaimCompletionRejectedError(logicalOperationKey, invocationId);
    }
  }
}
