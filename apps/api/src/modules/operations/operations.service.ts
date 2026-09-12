import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderIntelligenceService } from '../provider-intelligence/provider-intelligence.service';

const ATTENTION_LIMIT = 20;

type CountRow = { status: string; count: bigint };
type ScalarCountRow = { count: bigint };

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerIntelligence: ProviderIntelligenceService,
  ) {}

  async summary(organizationId: string) {
    const [
      workflowCounts,
      attentionRuns,
      employeeCounts,
      sourceCounts,
      memoryCounts,
      knowledgeUnitCount,
      pendingSkillPromotionCount,
      providers,
    ] = await Promise.all([
      this.workflowStatusCounts(organizationId),
      this.prisma.workflowRun.findMany({
        where: {
          organizationId,
          status: { in: ['BLOCKED', 'FAILED'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: ATTENTION_LIMIT,
        select: {
          id: true,
          status: true,
          currentStepType: true,
          blockReasonCode: true,
          failureReasonCode: true,
          correlationId: true,
          updatedAt: true,
        },
      }),
      this.prisma.digitalEmployee.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.prisma.source.groupBy({
        by: ['ingestionStatus'],
        where: { organizationId },
        _count: { _all: true },
      }),
      this.memoryStatusCounts(organizationId),
      this.scalarCount(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "knowledge_units"
        WHERE "organizationId" = ${organizationId}
      `),
      this.scalarCount(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "skill_promotion_reviews"
        WHERE "organization_id" = ${organizationId}
          AND "status" = 'PENDING_REVIEW'
      `),
      this.providerIntelligence.snapshot(organizationId),
    ]);

    const workflowTotal = Object.values(workflowCounts).reduce((sum, count) => sum + count, 0);
    const employeeByStatus = Object.fromEntries(
      employeeCounts.map((row) => [String(row.status), row._count._all]),
    );
    const sourceByStatus = Object.fromEntries(
      sourceCounts.map((row) => [String(row.ingestionStatus), row._count._all]),
    );
    const capabilityGaps = providers.capabilityCoverage
      .filter((item) => item.readiness !== 'ROUTABLE_BASELINE')
      .map((item) => ({
        capabilityCode: item.capabilityCode,
        readiness: item.readiness,
        enabledProviderCount: item.enabledProviderCount,
      }));

    return {
      organizationId,
      observedAt: new Date(),
      authority: 'READ_ONLY' as const,
      semantics: {
        executionSuccessIsNotTaskQuality: true,
        providerCostIsEstimateNotBilling: true,
      },
      workflows: {
        total: workflowTotal,
        byStatus: workflowCounts,
        attentionCount: attentionRuns.length,
        recentAttention: attentionRuns,
        attentionLimit: ATTENTION_LIMIT,
      },
      workforce: {
        total: Object.values(employeeByStatus).reduce((sum, count) => sum + count, 0),
        byStatus: employeeByStatus,
      },
      knowledge: {
        sources: {
          total: Object.values(sourceByStatus).reduce((sum, count) => sum + count, 0),
          byIngestionStatus: sourceByStatus,
        },
        knowledgeUnits: knowledgeUnitCount,
      },
      memory: {
        byStatus: memoryCounts,
        total: Object.values(memoryCounts).reduce((sum, count) => sum + count, 0),
      },
      governance: {
        pendingSkillPromotionReviews: pendingSkillPromotionCount,
      },
      providers: {
        registeredCount: providers.providers.length,
        routingWindowDecisionCount: providers.routing.observedDecisionCount,
        selectionRate: providers.routing.selectionRate,
        capabilityGapCount: capabilityGaps.length,
        capabilityGaps,
        costVisibility: providers.costVisibility,
      },
    };
  }

  private async workflowStatusCounts(organizationId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.workflowRun.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((row) => [String(row.status), row._count._all]));
  }

  private async memoryStatusCounts(organizationId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT "status"::text AS status, COUNT(*)::bigint AS count
      FROM "memory_entries"
      WHERE "organizationId" = ${organizationId}
      GROUP BY "status"
    `);
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  private async scalarCount(query: Prisma.Sql): Promise<number> {
    const rows = await this.prisma.$queryRaw<ScalarCountRow[]>(query);
    return Number(rows[0]?.count ?? 0n);
  }
}
