'use client';

import { useActionState } from 'react';
import { createGoalPlan, initialGoalPlanningState } from '@/lib/planning/actions';
import type { GoalPlan } from '@/lib/planning/contracts';

export function PlanningClient() {
  const [state, action, pending] = useActionState(createGoalPlan, initialGoalPlanningState);
  return <>
    <section className="plan-panel">
      <div className="plan-head"><div><span className="eyebrow">01 · Human intent</span><h2>Ziel formulieren</h2></div><span className="plan-state">DRAFT ONLY</span></div>
      <form action={action} className="plan-form">
        <label>Ziel<textarea name="goal" minLength={10} maxLength={2000} required placeholder="Beschreibe das gewünschte technische Ergebnis, die Grenzen und die relevanten Erfolgskriterien." /></label>
        <label>Assurance Level<select name="assuranceLevel" defaultValue="AL3"><option value="AL1">AL1</option><option value="AL2">AL2</option><option value="AL3">AL3</option><option value="AL4">AL4</option></select></label>
        <button disabled={pending} type="submit">{pending ? 'Plan wird serverseitig erzeugt…' : 'Governed Plan erzeugen'}</button>
      </form>
      {state.error ? <div className="plan-error">Planung fehlgeschlagen oder abgelehnt: {state.error}</div> : null}
    </section>
    {state.plan ? <PlanView plan={state.plan} /> : null}
  </>;
}

function PlanView({ plan }: Readonly<{ plan: GoalPlan }>) {
  return <>
    <section className="plan-panel"><div className="plan-head"><div><span className="eyebrow">02 · Server-owned plan</span><h2>{plan.goal}</h2></div><span className="plan-state">{plan.assuranceLevel} · NON-EXECUTABLE</span></div>
      <div className="plan-facts"><Fact label="Planning mode" value={plan.planningMode} /><Fact label="Goal class" value={plan.goalClass} /><Fact label="Provider" value={plan.providerSelection} /><Fact label="Next action" value={plan.nextAction} /></div>
      <div className="plan-boundary"><strong>Human Release Gate bleibt zwingend</strong><p>Dieser View zeigt den vom Backend erzeugten Plan. Er erzeugt keinen Workflow, wählt keinen Provider und erteilt keine Execution Authority.</p></div>
    </section>
    <section className="plan-panel"><span className="eyebrow">03 · Governed sequence</span><h2>Plan-Schritte</h2><div className="plan-steps">{plan.steps.map((step) => <article className={step.humanBoundary ? 'plan-step human' : 'plan-step'} key={`${step.order}-${step.stepType}`}><span>{String(step.order).padStart(2, '0')}</span><div><strong>{step.stepType}</strong><small>{step.capabilityCode ?? 'No agent capability · governance-owned'}</small></div><div><b>{step.executionAuthority}</b>{step.humanBoundary ? <em>HUMAN BOUNDARY</em> : null}</div></article>)}</div>
      <div className="plan-loop"><strong>Correction loop</strong><span>{plan.correctionLoop.trigger} → {plan.correctionLoop.stepType} → {plan.correctionLoop.returnsTo} · max {plan.correctionLoop.maxLoops}</span></div>
    </section>
    <section className="plan-evidence-grid"><Evidence title="Knowledge Evidence" items={plan.knowledgeEvidence.map((item) => ({ id: item.knowledgeUnitId, meta: `${item.sourceId} · ${item.locatorType ?? 'source'} ${item.locatorValue ?? ''}`, content: item.content }))} /><Evidence title="Memory Evidence" items={plan.memoryEvidence.map((item) => ({ id: item.memoryEntryId, meta: `${item.scope} · ${item.kind} · confidence ${item.confidence}`, content: `${item.title}\n${item.content}` }))} /></section>
  </>;
}

function Fact({ label, value }: Readonly<{ label: string; value: string }>) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function Evidence({ title, items }: Readonly<{ title: string; items: readonly Readonly<{ id: string; meta: string; content: string }>[] }>) { return <section className="plan-panel"><span className="eyebrow">Evidence</span><h2>{title}</h2>{items.length === 0 ? <p className="plan-empty">Keine Evidenz vom Planner zurückgegeben.</p> : <div className="plan-evidence">{items.map((item) => <article key={item.id}><small>{item.meta}</small><p>{item.content}</p></article>)}</div>}</section>; }
