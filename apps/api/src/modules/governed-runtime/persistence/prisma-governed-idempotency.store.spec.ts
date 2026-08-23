import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  PrismaGovernedIdempotencyStore,
  GovernedClaimCompletionRejectedError,
} from './prisma-governed-idempotency.store';

/**
 * Fokussierte B2a-Tests für den PrismaGovernedIdempotencyStore.
 *
 * Der Fake emuliert exakt die PostgreSQL-Einzigartigkeitssemantik:
 * - UNIQUE(logicalOperationKey)
 * - UNIQUE(invocationId)
 * Verletzungen werfen PrismaClientKnownRequestError(P2002). Die
 * Konkurrenz-Korrektheit kommt aus der Datenbank, NICHT aus einem
 * In-Process-Mutex. Zwei Store-Instanzen teilen sich dieselbe "Datenbank"
 * und beweisen: Prozessspeicher ist nie autoritativ.
 */

type ClaimState = 'IN_PROGRESS' | 'COMPLETED' | 'TIMED_OUT_UNKNOWN' | 'FAILED_UNKNOWN';

interface Row {
  id: string;
  logicalOperationKey: string;
  invocationId: string;
  contextFingerprint: string;
  state: ClaimState;
  claimedAt: Date;
  updatedAt: Date;
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function p2002(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test-client',
  });
}

class FakeClaimDelegate {
  rows: Row[] = [];
  private seq = 0;

  async create({
    data,
  }: {
    data: { logicalOperationKey: string; invocationId: string; contextFingerprint: string };
  }): Promise<Row> {
    await tick();
    const clash =
      this.rows.some((r) => r.logicalOperationKey === data.logicalOperationKey) ||
      this.rows.some((r) => r.invocationId === data.invocationId);
    if (clash) throw p2002();
    const row: Row = {
      id: `claim-${++this.seq}`,
      logicalOperationKey: data.logicalOperationKey,
      invocationId: data.invocationId,
      contextFingerprint: data.contextFingerprint,
      state: 'IN_PROGRESS',
      claimedAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return { ...row };
  }

  async findUnique({ where }: { where: { logicalOperationKey: string } }): Promise<Row | null> {
    await tick();
    const row = this.rows.find((r) => r.logicalOperationKey === where.logicalOperationKey);
    return row ? { ...row } : null;
  }

  async findFirst({ where }: { where: { invocationId: string } }): Promise<Row | null> {
    await tick();
    const row = this.rows.find((r) => r.invocationId === where.invocationId);
    return row ? { ...row } : null;
  }

  async updateMany({
    where,
    data,
  }: {
    where: { logicalOperationKey: string; invocationId: string; state: ClaimState };
    data: { state: ClaimState };
  }): Promise<{ count: number }> {
    await tick();
    let count = 0;
    for (const row of this.rows) {
      if (
        row.logicalOperationKey === where.logicalOperationKey &&
        row.invocationId === where.invocationId &&
        row.state === where.state
      ) {
        row.state = data.state;
        row.updatedAt = new Date();
        count++;
      }
    }
    return { count };
  }
}

const KEY_A = 'logop-v2|org:5:org-a|run:5:run-a|step:6:step-a|cap:10:CODE_BUILD|action:11:CREATE_FILE|path:9:a.txt';
const KEY_B = 'logop-v2|org:5:org-a|run:5:run-a|step:6:step-b|cap:10:CODE_BUILD|action:11:CREATE_FILE|path:9:b.txt';
const FP_A = 'v1|org:5:org-a|prov:9:provider-1';
const FP_B = 'v1|org:5:org-a|prov:9:provider-2';

function buildStores() {
  const delegate = new FakeClaimDelegate();
  const db = { governedInvocationClaim: delegate };
  const storeA = new PrismaGovernedIdempotencyStore(db as unknown as PrismaService);
  const storeB = new PrismaGovernedIdempotencyStore(db as unknown as PrismaService);
  return { delegate, storeA, storeB };
}

describe('PrismaGovernedIdempotencyStore — claim()', () => {
  it('evidence 2: the first claim of a logical operation becomes CLAIMED owner with IN_PROGRESS state', async () => {
    const { delegate, storeA } = buildStores();
    const result = await storeA.claim(KEY_A, 'inv-1', FP_A);
    expect(result.outcome).toBe('CLAIMED');
    if (result.outcome !== 'CLAIMED') return;
    expect(result.claim.logicalOperationKey).toBe(KEY_A);
    expect(result.claim.invocationId).toBe('inv-1');
    expect(result.claim.contextFingerprint).toBe(FP_A);
    expect(result.claim.state).toBe('IN_PROGRESS');
    expect(delegate.rows).toHaveLength(1);
    expect(delegate.rows[0].state).toBe('IN_PROGRESS');
  });

  it('evidence 3: same logical operation, different attempt -> DUPLICATE with owner evidence', async () => {
    const { storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    const result = await storeA.claim(KEY_A, 'inv-2', FP_A);
    expect(result.outcome).toBe('DUPLICATE');
    if (result.outcome !== 'DUPLICATE') return;
    expect(result.existing.invocationId).toBe('inv-1');
  });

  it('same attempt re-claiming its own operation is still DUPLICATE (no silent reacquisition)', async () => {
    const { storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    const result = await storeA.claim(KEY_A, 'inv-1', FP_A);
    expect(result.outcome).toBe('DUPLICATE');
    if (result.outcome !== 'DUPLICATE') return;
    expect(result.existing.invocationId).toBe('inv-1');
  });

  it('same logical operation with mismatching context fingerprint stays DUPLICATE at the logical level; original fingerprint evidence is preserved', async () => {
    // Frozen contract: the fingerprint difference is forensic evidence only
    // and NEVER an execution permission — the logical level stays DUPLICATE.
    const { storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    const result = await storeA.claim(KEY_A, 'inv-2', FP_B);
    expect(result.outcome).toBe('DUPLICATE');
    if (result.outcome !== 'DUPLICATE') return;
    expect(result.existing.contextFingerprint).toBe(FP_A);
  });

  it('evidence 4 (frozen semantics): the same invocationId under a DIFFERENT logical key is CONTEXT_CONFLICT', async () => {
    const { storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    const result = await storeA.claim(KEY_B, 'inv-1', FP_B);
    expect(result.outcome).toBe('CONTEXT_CONFLICT');
    if (result.outcome !== 'CONTEXT_CONFLICT') return;
    expect(result.existingInvocationId).toBe('inv-1');
  });

  it('a fresh attempt on an unclaimed key claims normally even after other keys exist', async () => {
    const { storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    const result = await storeA.claim(KEY_B, 'inv-2', FP_B);
    expect(result.outcome).toBe('CLAIMED');
  });

  it('non-P2002 persistence errors are never swallowed into claim outcomes', async () => {
    const { storeA } = buildStores();
    const failing = {
      governedInvocationClaim: {
        create: async () => {
          throw new Error('connection refused');
        },
      },
    };
    const broken = new PrismaGovernedIdempotencyStore(failing as unknown as PrismaService);
    await expect(broken.claim(KEY_A, 'inv-1', FP_A)).rejects.toThrow('connection refused');
    void storeA;
  });
});

describe('PrismaGovernedIdempotencyStore — markCompleted()', () => {
  it('evidence 5: markCompleted succeeds ONLY for the owning invocation', async () => {
    const { delegate, storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    await expect(storeA.markCompleted(KEY_A, 'inv-1', 'COMPLETED')).resolves.toBeUndefined();
    expect(delegate.rows[0].state).toBe('COMPLETED');
  });

  it('advances to TIMED_OUT_UNKNOWN and keeps the claim locked (never released)', async () => {
    const { delegate, storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    await expect(storeA.markCompleted(KEY_A, 'inv-1', 'TIMED_OUT_UNKNOWN')).resolves.toBeUndefined();
    expect(delegate.rows[0].state).toBe('TIMED_OUT_UNKNOWN');
  });

  it('evidence 6: a non-owner cannot complete another claim; the claim is unchanged', async () => {
    const { delegate, storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    await expect(storeA.markCompleted(KEY_A, 'inv-other', 'COMPLETED')).rejects.toThrow(
      GovernedClaimCompletionRejectedError,
    );
    expect(delegate.rows[0].state).toBe('IN_PROGRESS');
    expect(delegate.rows[0].invocationId).toBe('inv-1');
  });

  it('completing an unknown logical key is rejected', async () => {
    const { storeA } = buildStores();
    await expect(storeA.markCompleted('missing-key', 'inv-1', 'COMPLETED')).rejects.toThrow(
      GovernedClaimCompletionRejectedError,
    );
  });

  it('double completion is rejected (single forward transition, no reopen/release)', async () => {
    const { delegate, storeA } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    await storeA.markCompleted(KEY_A, 'inv-1', 'COMPLETED');
    await expect(storeA.markCompleted(KEY_A, 'inv-1', 'COMPLETED')).rejects.toThrow(
      GovernedClaimCompletionRejectedError,
    );
    expect(delegate.rows[0].state).toBe('COMPLETED');
  });
});

describe('PrismaGovernedIdempotencyStore — concurrency & cross-instance durability', () => {
  it('evidence 7: two simultaneous claims of one logical operation yield exactly one CLAIMED and no double ownership', async () => {
    const { delegate, storeA, storeB } = buildStores();
    const [a, b] = await Promise.all([
      storeA.claim(KEY_A, 'inv-a', FP_A),
      storeB.claim(KEY_A, 'inv-b', FP_B),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['CLAIMED', 'DUPLICATE']);
    const owners = delegate.rows.filter((r) => r.logicalOperationKey === KEY_A);
    expect(owners).toHaveLength(1);
  });

  it('evidence 8: persistence survives separate store instances over the same database', async () => {
    const { storeA, storeB } = buildStores();
    await storeA.claim(KEY_A, 'inv-1', FP_A);
    const replayViaSecondInstance = await storeB.claim(KEY_A, 'inv-fresh-after-restart', FP_A);
    expect(replayViaSecondInstance.outcome).toBe('DUPLICATE');
    if (replayViaSecondInstance.outcome !== 'DUPLICATE') return;
    expect(replayViaSecondInstance.existing.invocationId).toBe('inv-1');
  });
});
