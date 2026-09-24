import './workflows.css';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseMissionContextSnapshot, type MissionContextSnapshot } from '@/lib/missions/contracts';
import { parseOperationsSummary, type OperationsAttentionRun } from '@/lib/operations/contracts';
import { workflowAction } from '@/lib/workflows/actions';
import { parseWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/workflows/contracts';

export const metadata = { title: 'Workflows' };

type PageSearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

const NOTICE_COPY: Readonly<Record<string, string>> = {
  STARTED: 'Workflow gestartet. Der erste persistierte Step ist bereit.',
  RESUMED: 'Workflow fortgesetzt. Provider-blockierte Steps wurden lediglich wieder auf READY gesetzt.',
  EXECUTED: 'Aktueller Agent-Step wurde über die bestehende governte Runtime ausgeführt.',
  AL4_REVIEWS_COORDINATED: 'Die zwei AL4-Reviews wurden serverseitig über den governeden Review Coordinator koordiniert. Provider- und Model-Family-Unabhängigkeit bleiben Backend-owned.',
  VERDICT_PROCESSED: 'Persistiertes Review-Verdict wurde serverseitig gegen die governte RED_TEAM-Evidenz validiert und durch die bestehende State Machine verarbeitet.',
  RELEASE_APPROVED: 'Human Release wurde ausdrücklich freigegeben. Der Workflow steht jetzt bei RELEASE_EXECUTION; die Release-Ausführung wurde nicht automatisch gestartet.',
  CANCELLED: 'Emergency Stop ausgeführt. Der Run und alle noch aktiven Steps wurden abgebrochen; es wurde keine weitere Ausführung gestartet.',
};

export default async function WorkflowsPage({ searchParams }: Readonly<{ searchParams: PageSearchParams }>) {
  const params = await searchParams;
  const requestedRun = first(params.run)?.trim().slice(0, 512) ?? '';
  const notice = first(params.notice);
  const error = first(params.error);

  let attention: readonly OperationsAttentionRun[] = [];
  let snapshot: WorkflowSnapshot | null = null;
  let mission: MissionContextSnapshot | null = null;
  let loadError: string | null = null;

  try {
    const client = await createAuthenticatedVitoApiClient();
    const operations = await client.get('/operations/summary', parseOperationsSummary);
    attention = operations.workflows.recentAttention;
    if (requestedRun) {
      const encodedRun = encodeURIComponent(requestedRun);
      [snapshot, mission] = await Promise.all([
        client.get(`/workflow-observer/${encodedRun}`, parseWorkflowSnapshot),
        client.get(`/mission-context/${encodedRun}`, parseMissionContextSnapshot),
      ]);
    }
  } catch (caught) {
    loadError = caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR';
  }

  return (
    <main>
      <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Workflows</span></div>
      <section className="module-heading"><div className="module-icon">MI</div><div><span className="eyebrow">Mission · governed execution</span><h1>Mission & Workflow Cockpit</h1><p>Ziel, gemeinsamen Missionskontext und persistierte Ausführung beobachten. Mutierende Aktionen bleiben vollständig backend-gesteuert.</p></div></section>
      <div className="boundary-notice"><span className="system-dot" /><div><strong>Human gates bleiben harte Grenzen</strong><p>Das Cockpit bestätigt niemals selbstständig. Eine Release-Freigabe erscheint nur, wenn das Backend explizit APPROVE_HUMAN_RELEASE meldet, und erfordert einen bewussten Klick eines authentifizierten OWNER/ADMIN.</p></div></div>
      {notice && NOTICE_COPY[notice] ? <div className="workflow-banner workflow-banner-success">{NOTICE_COPY[notice]}</div> : null}
      {error ? <div className="workflow-banner workflow-banner-error">Aktion abgelehnt oder fehlgeschlagen: {error}</div> : null}
      {loadError ? <div className="workflow-banner workflow-banner-error">Workflow-Daten konnten nicht geladen werden: {loadError}</div> : null}
      {mission ? <MissionContextView mission={mission} /> : null}
      <section className="workflow-grid">
        <div className="workflow-panel"><span className="eyebrow">01 · Select</span><h2>Run öffnen</h2><form method="get" className="workflow-search"><input name="run" defaultValue={requestedRun} maxLength={512} placeholder="Workflow Run ID" required /><button type="submit">Beobachten</button></form><p className="workflow-muted">Alternativ einen Run aus der aktuellen Attention-Liste auswählen.</p><div className="workflow-attention-list">{attention.length === 0 ? <p className="workflow-muted">Keine Attention-Runs gemeldet.</p> : attention.map((run) => <AttentionRun key={run.id} run={run} />)}</div></div>
        <div className="workflow-panel"><span className="eyebrow">02 · Governed action</span><h2>Nächste Aktion</h2>{snapshot ? <ActionPanel snapshot={snapshot} /> : <p className="workflow-muted">Run auswählen, um die serverseitig klassifizierte nächste Aktion zu sehen.</p>}</div>
      </section>
      {snapshot ? <SnapshotView snapshot={snapshot} /> : null}
    </main>
  );
}

function MissionContextView({ mission }: Readonly<{ mission: MissionContextSnapshot }>) {
  return <section className="mission-context-panel">
    <div className="workflow-section-head"><div><span className="eyebrow">Mission · Shared Context</span><h2>{mission.objective}</h2></div><span className="status-chip">ADVISORY CONTEXT</span></div>
    <div className="mission-context-grid">
      <Metric label="Mission" value={mission.missionId} />
      <Metric label="Status" value={mission.workflow.status} />
      <Metric label="Current step" value={mission.workflow.currentStepType ?? '—'} />
      <Metric label="Assurance" value={mission.workflow.assuranceLevel} />
      <Metric label="Completed steps" value={String(mission.progress.completedSteps.length)} />
      <Metric label="Shared memory" value={String(mission.memoryRefs.length)} />
    </div>
    <div className="mission-context-body">
      <div><small>Progress</small><p>{mission.progress.completedSteps.length ? mission.progress.completedSteps.join(' → ') : 'Noch kein Step abgeschlossen.'}</p></div>
      <div><small>Governance</small><p>{mission.governance.waitingForHuman ? 'Wartet auf eine menschliche Grenze oder ist blockiert.' : 'Kein aktueller Human-Wait-State.'}</p></div>
      <div><small>Outcome</small><p>{mission.outcome.terminal ? `Terminal: ${mission.outcome.status}` : `Offen: ${mission.outcome.status}`}{mission.outcome.blockReasonCode ? ` · Block: ${mission.outcome.blockReasonCode}` : ''}{mission.outcome.failureReasonCode ? ` · Failure: ${mission.outcome.failureReasonCode}` : ''}</p></div>
    </div>
    <p className="workflow-muted">Dieser Kontext hilft Agenten und Menschen bei der Orientierung. Er verleiht keine Capability, keine Provider-Auswahl und keine Freigabe.</p>
  </section>;
}

function AttentionRun({ run }: Readonly<{ run: OperationsAttentionRun }>) { return <a className="workflow-attention" href={`/workflows?run=${encodeURIComponent(run.id)}`}><div><strong>{run.status}</strong><span>{run.currentStepType ?? 'no current step'}</span></div><small>{run.blockReasonCode ?? run.failureReasonCode ?? run.id}</small></a>; }

function ActionPanel({ snapshot }: Readonly<{ snapshot: WorkflowSnapshot }>) {
  const actionable = snapshot.nextAction === 'START_RUN' || snapshot.nextAction === 'RESUME_RUN' || snapshot.nextAction === 'EXECUTE_CURRENT_STEP' || snapshot.nextAction === 'COORDINATE_AL4_REVIEWS' || snapshot.nextAction === 'PROCESS_REVIEW_VERDICT' || snapshot.nextAction === 'APPROVE_HUMAN_RELEASE';
  const labels: Readonly<Record<string, string>> = { START_RUN: 'Workflow starten', RESUME_RUN: 'Workflow resumieren', EXECUTE_CURRENT_STEP: 'Aktuellen Agent-Step ausführen', COORDINATE_AL4_REVIEWS: 'AL4 Reviews serverseitig koordinieren', PROCESS_REVIEW_VERDICT: 'Review-Verdict serverseitig verarbeiten', APPROVE_HUMAN_RELEASE: 'Human Release ausdrücklich freigeben', HUMAN_REVIEW_REQUIRED: 'Human Review erforderlich', NONE: 'Keine Aktion' };
  const isAl4ReviewCoordination = snapshot.nextAction === 'COORDINATE_AL4_REVIEWS';
  const isReleaseApproval = snapshot.nextAction === 'APPROVE_HUMAN_RELEASE';
  const isVerdictProcessing = snapshot.nextAction === 'PROCESS_REVIEW_VERDICT';
  const canCancel = snapshot.status === 'CREATED' || snapshot.status === 'RUNNING' || snapshot.status === 'WAITING_FOR_HUMAN' || snapshot.status === 'BLOCKED';
  return <div className="workflow-action-card"><div className="workflow-state-row"><span>Status</span><strong>{snapshot.status}</strong></div><div className="workflow-state-row"><span>Boundary</span><strong>{snapshot.boundary}</strong></div><div className="workflow-state-row"><span>Next action</span><strong>{snapshot.nextAction}</strong></div>{snapshot.blockReasonCode ? <div className="workflow-reason">Block: {snapshot.blockReasonCode}</div> : null}{snapshot.failureReasonCode ? <div className="workflow-reason">Failure: {snapshot.failureReasonCode}</div> : null}{isAl4ReviewCoordination ? <div className="workflow-reason"><strong>Server-owned AL4 Review:</strong> Der Browser wählt weder Provider noch Modellfamilie. Der Backend-Coordinator erzeugt die erforderlichen unabhängigen RED_TEAM-Reviews und persistiert ausschließlich governte Evidence-Lineage.</div> : null}{isVerdictProcessing ? <div className="workflow-reason"><strong>Server-owned Review:</strong> Der Browser liefert kein Verdict. Das Backend validiert ausschließlich die bereits persistierte typed ReviewResult-Projektion gegen die governte RED_TEAM-Evidenz und delegiert an die bestehende State Machine.</div> : null}{isReleaseApproval ? <div className="workflow-reason"><strong>Explizite Human-Freigabe:</strong> Dieser Klick bestätigt nur den HUMAN_RELEASE_GATE und setzt RELEASE_EXECUTION bereit. Er startet keine Release-Ausführung.</div> : null}{actionable ? <form action={workflowAction}><input type="hidden" name="workflowRunId" value={snapshot.workflowRunId} /><input type="hidden" name="action" value={snapshot.nextAction} /><button className="primary-button" type="submit">{labels[snapshot.nextAction]}</button></form> : <div className="workflow-governance-stop"><strong>{labels[snapshot.nextAction] ?? snapshot.nextAction}</strong><p>Keine mutierende Aktion wird angeboten. Andere Human Reviews bleiben harte Governance-Grenzen.</p></div>}{canCancel ? <form action={workflowAction} className="workflow-emergency-stop"><input type="hidden" name="workflowRunId" value={snapshot.workflowRunId} /><input type="hidden" name="action" value="CANCEL_RUN" /><label><input type="checkbox" name="confirmCancel" value="YES" required /> Ich bestätige den Abbruch dieses Runs.</label><button type="submit">Emergency Stop · Run abbrechen</button><small>Bricht den Run und aktive Steps ab. Startet keine weitere Ausführung.</small></form> : null}</div>;
}

function SnapshotView({ snapshot }: Readonly<{ snapshot: WorkflowSnapshot }>) { return <section className="workflow-detail"><div className="workflow-section-head"><div><span className="eyebrow">03 · Observer</span><h2>Persistierter Run</h2></div><span className="status-chip">READ ONLY SNAPSHOT</span></div><div className="workflow-summary"><Metric label="Run" value={snapshot.workflowRunId} /><Metric label="Current step" value={snapshot.currentStepType ?? '—'} /><Metric label="Correction loops" value={`${snapshot.correctionLoopCount} / ${snapshot.maxCorrectionLoops}`} /><Metric label="Observed" value={formatDate(snapshot.observedAt)} /></div><h3>Steps</h3><div className="workflow-step-list">{snapshot.steps.map((step) => <article className="workflow-step" key={step.id}><div><strong>{step.stepType}</strong><span>attempt {step.attemptNumber}</span></div><span className="workflow-step-status">{step.status}</span><small>{formatDate(step.startedAt)}{step.finishedAt ? ` → ${formatDate(step.finishedAt)}` : ''}</small></article>)}</div><h3>Audit timeline</h3><div className="workflow-timeline">{snapshot.timeline.map((event) => <article key={event.id}><time>{formatDate(event.createdAt)}</time><strong>{event.action}</strong><span>{event.actorType} · {event.entityType}</span></article>)}{snapshot.timeline.length === 0 ? <p className="workflow-muted">Keine Audit-Events im Snapshot.</p> : null}</div>{snapshot.timelineTruncated ? <p className="workflow-muted">Timeline auf die serverseitige Maximalzahl begrenzt.</p> : null}</section>; }
function Metric({ label, value }: Readonly<{ label: string; value: string }>) { return <div className="workflow-metric"><small>{label}</small><strong>{value}</strong></div>; }
function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function formatDate(value: string): string { return new Date(value).toLocaleString('de-DE'); }
