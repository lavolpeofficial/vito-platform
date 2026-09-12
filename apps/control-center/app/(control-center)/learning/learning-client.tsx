'use client';

import { useActionState } from 'react';
import { loadLearning, type LearningSearchState } from '@/lib/learning/actions';
import type { ExperienceRecord } from '@/lib/learning/contracts';

const initialState: LearningSearchState = { experiences: [], selected: null, outcomes: [], reflections: [], error: null };

export function LearningClient() {
  const [state, action, pending] = useActionState(loadLearning, initialState);
  return <>
    <form action={action} className="learning-search">
      <label><span>Agent ID</span><input name="agentId" placeholder="Optional digital employee ID" /></label>
      <label><span>Status</span><select name="status" defaultValue=""><option value="">All statuses</option><option>OBSERVED</option><option>EVALUATED</option><option>REFLECTED</option><option>LEARNING_CANDIDATE</option><option>ARCHIVED</option></select></label>
      <label><span>Experience ID</span><input name="experienceId" placeholder="Optional exact experience" /></label>
      <button type="submit" disabled={pending}>{pending ? 'Loading…' : 'Load learning'}</button>
    </form>
    {state.error ? <div className="learning-banner">Learning observability failed: {state.error}</div> : null}
    {state.selected ? <ExperienceDetail state={state} /> : <ExperienceList experiences={state.experiences} />}
  </>;
}

function ExperienceList({ experiences }: Readonly<{ experiences: readonly ExperienceRecord[] }>) {
  return <section className="learning-panel"><div className="learning-head"><div><span className="eyebrow">01 · Experience store</span><h2>Experiences</h2></div><span>{experiences.length} results</span></div>{experiences.length === 0 ? <p className="learning-empty">Load tenant-scoped learning experiences. Filtering, persistence and status semantics remain backend-owned.</p> : <div className="learning-list">{experiences.map((experience) => <ExperienceCard key={experience.id} experience={experience} />)}</div>}</section>;
}

function ExperienceCard({ experience }: Readonly<{ experience: ExperienceRecord }>) {
  return <article className="learning-card"><div className="learning-card-top"><div><strong>{experience.goal}</strong><span>{new Date(experience.createdAt).toLocaleString('de-DE')}</span></div><span className="learning-status">{experience.status}</span></div><dl><Row label="Experience" value={experience.id} /><Row label="Agent" value={experience.agentId} /><Row label="Success" value={experience.successScore === null ? 'not scored' : String(experience.successScore)} /><Row label="Confidence" value={experience.confidence === null ? 'not specified' : String(experience.confidence)} /></dl>{experience.lesson ? <p className="learning-lesson">{experience.lesson}</p> : null}</article>;
}

function ExperienceDetail({ state }: Readonly<{ state: LearningSearchState }>) {
  const experience = state.selected!;
  return <div className="learning-grid"><section className="learning-panel"><div className="learning-head"><div><span className="eyebrow">01 · Experience</span><h2>{experience.goal}</h2></div><span className="learning-status">{experience.status}</span></div><dl><Row label="Experience" value={experience.id} /><Row label="Agent" value={experience.agentId} /><Row label="Success" value={experience.successScore === null ? 'not scored' : String(experience.successScore)} /><Row label="Confidence" value={experience.confidence === null ? 'not specified' : String(experience.confidence)} /></dl><details><summary>Persisted runtime evidence</summary><pre>{JSON.stringify({ context: experience.context, observation: experience.observation, decision: experience.decision, action: experience.action, result: experience.result, feedback: experience.feedback, reusablePattern: experience.reusablePattern }, null, 2)}</pre></details></section><section className="learning-panel"><div className="learning-head"><div><span className="eyebrow">02 · Objective outcome</span><h2>Outcomes</h2></div><span>{state.outcomes.length}</span></div>{state.outcomes.map((outcome) => <article className="learning-card" key={outcome.id}><strong>{outcome.metricCode}</strong><dl><Row label="Score" value={String(outcome.score)} /><Row label="Confidence" value={outcome.confidence === null ? 'not specified' : String(outcome.confidence)} /><Row label="Evaluator" value={`${outcome.evaluatorType}${outcome.evaluatorId ? ` · ${outcome.evaluatorId}` : ''}`} /></dl><details><summary>Evidence</summary><pre>{JSON.stringify(outcome.evidence, null, 2)}</pre></details></article>)}</section><section className="learning-panel"><div className="learning-head"><div><span className="eyebrow">03 · Reflection</span><h2>Reflections</h2></div><span>{state.reflections.length}</span></div>{state.reflections.map((reflection) => <article className="learning-card" key={reflection.id}><strong>{reflection.lesson}</strong>{reflection.nextActionHint ? <p>{reflection.nextActionHint}</p> : null}<dl><Row label="Confidence" value={reflection.confidence === null ? 'not specified' : String(reflection.confidence)} /><Row label="Evidence outcomes" value={reflection.evidenceOutcomeIds.join(', ')} /></dl></article>)}</section></div>;
}

function Row({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
