import './workflows.css';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseOperationsSummary, type OperationsAttentionRun } from '@/lib/operations/contracts';
import { workflowAction } from '@/lib/workflows/actions';
import { parseWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/workflows/contracts';

export const metadata = { title: 'Workflows' };

type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

const NOTICE_COPY: Readonly<Record<string, string>> = {
  STARTED: 'Workflow gestartet. Der erste persistierte Step ist bereit.',
  RESUMED: 'Workflow fortgesetzt. Provider-blockierte Steps wurden lediglich wieder auf READY gesetzt.',
  EXECUTED: 'Aktueller Agent-Step wurde über die bestehende governte Runtime ausgeführt.',
  VERDICT_PROCESSED: 'Persistiertes Review-Verdict wurde serverseitig gegen die governte RED_TEAM-Evidenz validiert und durch die bestehende State Machine verarbeitet.',
  RELEASE_APPROVED: 'Human Release wurde ausdrücklich freigegeben. Der Workflow steht jetzt bei RELEASE_EXECUTION; die Release-Ausführung wurde nicht automatisch gestartet.',
};

export default async function WorkflowsPage({ searchParams }: Readonly<{ searchParams: PageSearchParams }>) {
  const params = await searchParams;
  const requestedRun = first(params.run)?.trim().slice(0, 512) ?? '';
  const notice = first(params.notice);
  const error = first(params.error);

  let attention: readonly OperationsAttentionRun[] = [];
  let snapshot: WorkflowSnapshot | null = null;
  let loadError: string | null = null;

  try {
    const client = await createAuthenticatedVitoApiClient();
    const operations = await client.get('/operations/summary', parseOperationsSummary);
    attention = operations.workflows.recentAttention;
    if (requestedRun) snapshot = await client.get(`/workflow-observer/${encodeURIComponent(requestedRun)}`, parseWorkflowSnapshot);
  } catch (caught) {
    loadError = caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR';
  }

  return (
    <main>
      <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Workflows</span></div>
      <section className="module-heading"><div className="module-icon">WF</div><div><span className="eyebrow">Governed execution</span><h1>Workflow Cockpit</h1><p>Persistierte Runs beobachten, Step-Grenzen verstehen und ausschließlich die vom Backend freigegebene nächste Aktion auslösen.</p></div></section>
      <div className="boundary-notice"><span className="system-dot" /><div><strong>Human gates bleiben harte Grenzen</strong><p>Das Cockpit bestätigt niemals selbstständig. Eine Release-Freigabe erscheint nur, wenn das Backend explizit APPROVE_HUMAN_RELEASE meldet, und erfordert einen bewussten Klick eines authentifizierten OWNER/ADMIN.</p></div></div>
      {notice && NOTICE_COPY[notice] ? <div className="workflow-banner workflow-banner-success">{NOTICE_COPY[notice]}</div> : null}
      {error ? <div className="workflow-banner workflow-banner-error">Aktion abgelehnt oder fehlgeschlagen: {error}</div> : null}
      {loadError ? <div className="workflow-banner workflow-banner-error">Workflow-Daten konnten nicht geladen werden: {loadError}</div> : null}
      <section className="workflow-grid">
        <div className="workflow-panel"><span className="eyebrow">01 · Select</span><h2>Run öffnen</h2><form method="get" className="workflow-search"><input name="run" defaultValue={requestedRun} maxLength={512} placeholder="Workflow Run ID" required /><button type="submit">Beobachten</button></form><p className="workflow-muted">Alternativ einen Run aus der aktuellen Attention-Liste auswählen.</p><div className="workflow-attention-list">{attention.length === 0 ? <p className="workflow-muted">Keine Attention-Runs gemeldet.</p> : attention.map((run) => <AttentionRun key={run.id} run={run} />)}</div></div>
        <div className="workflow-panel"><span className="eyebrow">02 · Governed action</span><h2>Nächste Aktion</h2>{snapshot ? <ActionPanel snapshot={snapshot} /> : <p className="workflow-muted">Run auswählen, um die serverseitig klassifizierte nächste Aktion zu sehen.</p>}</div>
      </section>
      {snapshot ? <SnapshotView snapshot={snapshot} /> : null}
    </main>
  );
}

function AttentionRun({ run }: Readonly<{ run: OperationsAttentionRun }>) { return <a className="workflow-attention" href={`/workflows?run=${encodeURIComponent(run.id)}`}><div><strong>{run.status}</strong><span>{run.currentStepType ?? 'no current step'}</span></div><small>{run.blockReasonCode ?? run.failureReasonCode ?? run.id}</small></a>; }

function ActionPanel({ snapshot }: Readonly<{ snapshot: WorkflowSnapshot }>) {
  const actionable = snapshot.nextAction === 'START_RUN' || snapshot.nextAction === 'RESUME_RUN' || snapshot.nextAction === 'EXECUTE_CURRENT_STEP' || snapshot.nextAction === 'PROCESS_REVIEW_VERDICT' || snapshot.nextAction === 'APPROVE_HUMAN_RELEASE';
  const labels: Readonly<Record<string, string>> = { START_RUN: 'Workflow starten', RESUME_RUN: 'Workflow resumieren', EXECUTE_CURRENT_STEP: 'Aktuellen Agent-Step ausführen', PROCESS_REVIEW_VERDICT: 'Review-Verdict serverseitig verarbeiten', APPROVE_HUMAN_RELEASE: 'Human Release ausdrücklich freigeben', HUMAN_REVIEW_REQUIRED: 'Human Review erforderlich', NONE: 'Keine Aktion' };
  const isReleaseApproval = snapshot.nextAction === 'APPROVE_HUMAN_RELEASE';
  const isVerdictProcessing = snapshot.nextAction === 'PROCESS_REVIEW_VERDICT';
  return <div className="workflow-action-card"><div className="workflow-state-row"><span>Status</span><strong>{snapshot.status}</strong></div><div className="workflow-state-row"><span>Boundary</span><strong>{snapshot.boundary}</strong></div><div className="workflow-state-row"><span>Next action</span><strong>{snapshot.nextAction}</strong></div>{snapshot.blockReasonCode ? <div className="workflow-reason">Block: {snapshot.blockReasonCode}</div> : null}{snapshot.failureReasonCode ? <div className="workflow-reason">Failure: {snapshot.failureReasonCode}</div> : null}{isVerdictProcessing ? <div className="workflow-reason"><strong>Server-owned Review:</strong> Der Browser liefert kein Verdict. Das Backend validiert ausschließlich die bereits persistierte typed ReviewResult-Projektion gegen die governte RED_TEAM-Evidenz und delegiert an die bestehende State Machine.</div> : null}{isReleaseApproval ? <div className="workflow-reason"><strong>Explizite Human-Freigabe:</strong> Dieser Klick bestätigt nur den HUMAN_RELEASE_GATE und setzt RELEASE_EXECUTION bereit. Er startet keine Release-Ausführung.</div> : null}{actionable ? <form action={workflowAction}><input type="hidden" name="workflowRunId" value={snapshot.workflowRunId} /><input type="hidden" name="action" value={snapshot.nextAction} /><button className="primary-button" type="submit">{labels[snapshot.nextAction]}</button></form> : <div className="workflow-governance-stop"><strong>{labels[snapshot.nextAction] ?? snapshot.nextAction}</strong><p>Keine mutierende Aktion wird angeboten. Andere Human Reviews bleiben harte Governance-Grenzen.</p></div>}</div>;
}

function SnapshotView({ snapshot }: Readonly<{ snapshot: WorkflowSnapshot }>) { return <section className="workflow-detail"><div className="workflow-section-head"><div><span className="eyebrow">03 · Observer</span><h2>Persistierter Run</h2></div><span className="status-chip">READ ONLY SNAPSHOT</span></div><div className="workflow-summary"><Metric label="Run" value={snapshot.workflowRunId} /><Metric label="Current step" value={snapshot.currentStepType ?? '—'} /><Metric label="Correction loops" value={`${snapshot.correctionLoopCount} / ${snapshot.maxCorrectionLoops}`} /><Metric label="Observed" value={formatDate(snapshot.observedAt)} /></div><h3>Steps</h3><div className="workflow-step-list">{snapshot.steps.map((step) => <article className="workflow-step" key={step.id}><div><strong>{step.stepType}</strong><span>attempt {step.attemptNumber}</span></div><span className="workflow-step-status">{step.status}</span><small>{formatDate(step.startedAt)}{step.finishedAt ? ` → ${formatDate(step.finishedAt)}` : ''}</small></article>)}</div><h3>Audit timeline</h3><div className="workflow-timeline">{snapshot.timeline.map((event) => <article key={event.id}><time>{formatDate(event.createdAt)}</time><strong>{event.action}</strong><span>{event.actorType} · {event.entityType}</span></article>)}{snapshot.timeline.length === 0 ? <p className="workflow-muted">Keine Audit-Events im Snapshot.</p> : null}</div>{snapshot.timelineTruncated ? <p className="workflow-muted">Timeline auf die serverseitige Maximalzahl begrenzt.</p> : null}</section>; }
function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <div className="workflow-metric"><small>{label}</small><strong>{value}</strong></div>; }
function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function formatDate(value: string): string { return new Date(value).toLocaleString('de-DE'); }
