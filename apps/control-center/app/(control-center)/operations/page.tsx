import Link from 'next/link';
import { VitoApiError } from '@/lib/api/error';
import { getOperationsSummary } from '@/lib/operations/server';
import type { OperationsAttentionRun, OperationsSummary } from '@/lib/operations/contracts';
import './operations.css';

export const metadata = { title: 'Operations' };
export const dynamic = 'force-dynamic';

export default async function OperationsPage() {
  try {
    const summary = await getOperationsSummary();
    return <OperationsDashboard summary={summary} />;
  } catch (error) {
    return <OperationsFailure error={error} />;
  }
}

function OperationsDashboard({ summary }: Readonly<{ summary: OperationsSummary }>) {
  const blocked = summary.workflows.byStatus.BLOCKED ?? 0;
  const failed = summary.workflows.byStatus.FAILED ?? 0;
  const active = (summary.workflows.byStatus.RUNNING ?? 0) + (summary.workflows.byStatus.PENDING ?? 0);

  return (
    <section className="operations-page" aria-labelledby="operations-title">
      <div className="breadcrumb"><Link href="/">Control Center</Link><span>/</span><span>Operations</span></div>
      <header className="operations-heading">
        <div>
          <span className="eyebrow">READ-ONLY OPERATIONS</span>
          <h1 id="operations-title">Operational state, without invented certainty.</h1>
          <p>Live tenant-scoped telemetry from VITO. Execution success is runtime evidence, not a claim that the underlying task was semantically correct.</p>
        </div>
        <div className="observed-at"><span>Observed</span><strong>{formatDate(summary.observedAt)}</strong></div>
      </header>

      <div className="operations-kpi-grid" aria-label="Operational summary">
        <Kpi label="Workflows" value={summary.workflows.total} detail={`${active} active · ${blocked} blocked · ${failed} failed`} attention={blocked + failed > 0} />
        <Kpi label="Digital employees" value={summary.workforce.total} detail={formatCounts(summary.workforce.byStatus)} />
        <Kpi label="Knowledge units" value={summary.knowledge.knowledgeUnits} detail={`${summary.knowledge.sources.total} source${summary.knowledge.sources.total === 1 ? '' : 's'}`} />
        <Kpi label="Memory entries" value={summary.memory.total} detail={formatCounts(summary.memory.byStatus)} />
        <Kpi label="Governance reviews" value={summary.governance.pendingSkillPromotionReviews} detail="pending skill promotion" attention={summary.governance.pendingSkillPromotionReviews > 0} />
        <Kpi label="Provider gaps" value={summary.providers.capabilityGapCount} detail={`${summary.providers.registeredCount} provider${summary.providers.registeredCount === 1 ? '' : 's'} registered`} attention={summary.providers.capabilityGapCount > 0} />
      </div>

      <div className="operations-grid">
        <section className="operations-panel" aria-labelledby="attention-title">
          <div className="operations-panel-heading">
            <div><span className="eyebrow">ATTENTION QUEUE</span><h2 id="attention-title">Blocked & failed workflows</h2></div>
            <span className="status-chip">{summary.workflows.attentionCount}/{summary.workflows.attentionLimit}</span>
          </div>
          {summary.workflows.recentAttention.length === 0 ? (
            <div className="operations-empty">No blocked or failed workflow runs are currently in the bounded attention window.</div>
          ) : (
            <div className="attention-list">{summary.workflows.recentAttention.map((run) => <AttentionRun key={run.id} run={run} />)}</div>
          )}
        </section>

        <section className="operations-panel" aria-labelledby="providers-title">
          <div className="operations-panel-heading">
            <div><span className="eyebrow">PROVIDER READINESS</span><h2 id="providers-title">Capability gaps</h2></div>
            <span className="status-chip">{summary.providers.routingWindowDecisionCount} decisions</span>
          </div>
          {summary.providers.capabilityGaps.length === 0 ? (
            <div className="operations-empty">No provider capability gaps are reported by the current readiness snapshot.</div>
          ) : (
            <div className="capability-gap-list">{summary.providers.capabilityGaps.map((gap) => (
              <div className="capability-gap" key={gap.capabilityCode}>
                <div><strong>{gap.capabilityCode}</strong><small>{gap.readiness}</small></div>
                <span>{gap.enabledProviderCount} enabled</span>
              </div>
            ))}</div>
          )}
        </section>
      </div>

      <div className="boundary-notice operations-boundary">
        <span className="system-dot" />
        <div><strong>Observation boundary</strong><p>This dashboard is telemetry only. It cannot execute, resume, approve, route or promote anything. Provider cost data remains estimate-only and is not billing evidence.</p></div>
      </div>
    </section>
  );
}

function Kpi({ label, value, detail, attention = false }: Readonly<{ label: string; value: number; detail: string; attention?: boolean }>) {
  return <article className={`operations-kpi${attention ? ' operations-kpi-attention' : ''}`}><span>{label}</span><strong>{value.toLocaleString('en-US')}</strong><small>{detail}</small></article>;
}

function AttentionRun({ run }: Readonly<{ run: OperationsAttentionRun }>) {
  const reason = run.blockReasonCode ?? run.failureReasonCode ?? 'NO_REASON_CODE';
  return (
    <article className="attention-run">
      <div><strong>{run.status}</strong><span>{run.currentStepType ?? 'NO_CURRENT_STEP'}</span></div>
      <p>{reason}</p>
      <small>{shortId(run.id)} · {formatDate(run.updatedAt)}</small>
    </article>
  );
}

function OperationsFailure({ error }: Readonly<{ error: unknown }>) {
  const forbidden = error instanceof VitoApiError && error.status === 403;
  return (
    <section className="operations-page" aria-labelledby="operations-error-title">
      <div className="breadcrumb"><Link href="/">Control Center</Link><span>/</span><span>Operations</span></div>
      <span className="eyebrow">OPERATIONS UNAVAILABLE</span>
      <div className="empty-state operations-error">
        <span className="status-chip">{forbidden ? 'ACCESS BOUNDARY' : 'LIVE DATA ERROR'}</span>
        <h1 id="operations-error-title">{forbidden ? 'OWNER or ADMIN access is required.' : 'VITO operations telemetry is unavailable.'}</h1>
        <p>{forbidden ? 'The backend Operations API is intentionally restricted to governed administrative roles.' : 'The dashboard failed closed instead of rendering stale, partial or invented runtime data. Retry after the API connection is healthy.'}</p>
      </div>
    </section>
  );
}

function formatCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? 'no recorded statuses' : entries.map(([status, count]) => `${count} ${status.toLowerCase()}`).join(' · ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}

function shortId(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
