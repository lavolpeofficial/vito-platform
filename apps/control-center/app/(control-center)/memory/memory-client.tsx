'use client';

import { useActionState } from 'react';
import { searchMemory, type MemorySearchState } from '@/lib/memory/actions';
import type { MemoryEntry } from '@/lib/memory/contracts';

const initialState: MemorySearchState = { entries: [], error: null, query: '' };

export function MemoryClient() {
  const [state, action, pending] = useActionState(searchMemory, initialState);
  return <>
    <form action={action} className="memory-search">
      <label><span>Search memory</span><input name="query" maxLength={512} required placeholder="Goal, decision, customer, workflow, lesson…" /></label>
      <label><span>Scope</span><select name="scope" defaultValue=""><option value="">All active scopes</option><option>GLOBAL</option><option>ORGANIZATION</option><option>PROJECT</option><option>CUSTOMER</option><option>AGENT</option><option>WORKFLOW</option></select></label>
      <label><span>Scope ID</span><input name="scopeId" placeholder="Required for project/customer/agent/workflow" /></label>
      <button type="submit" disabled={pending}>{pending ? 'Searching…' : 'Search'}</button>
    </form>
    {state.error ? <div className="memory-banner">Memory search failed: {state.error}</div> : null}
    <section className="memory-panel"><div className="memory-head"><div><span className="eyebrow">01 · Runtime memory</span><h2>Active Memory</h2></div><span>{state.entries.length} results{state.query ? ` · “${state.query}”` : ''}</span></div>
      {!state.query ? <p className="memory-empty">Search the tenant-scoped memory store. The backend owns retrieval, ranking and scope enforcement.</p> : state.entries.length === 0 ? <p className="memory-empty">No active memory matched this query.</p> : <div className="memory-list">{state.entries.map((entry) => <MemoryCard key={entry.id} entry={entry} />)}</div>}
    </section>
  </>;
}

function MemoryCard({ entry }: Readonly<{ entry: MemoryEntry }>) {
  return <article className="memory-card"><div className="memory-card-top"><div><strong>{entry.title}</strong><span>{new Date(entry.createdAt).toLocaleString('de-DE')}</span></div><span className="memory-kind">{entry.kind}</span></div><p>{entry.content}</p><dl><Row label="Scope" value={`${entry.scope}${entry.scopeId ? ` · ${entry.scopeId}` : ''}`} /><Row label="Source" value={`${entry.sourceType}${entry.sourceRef ? ` · ${entry.sourceRef}` : ''}`} /><Row label="Confidence" value={entry.confidence === null ? 'not specified' : String(entry.confidence)} /><Row label="Memory ID" value={entry.id} /></dl>{Object.keys(entry.metadata).length ? <details><summary>Metadata</summary><pre>{JSON.stringify(entry.metadata, null, 2)}</pre></details> : null}</article>;
}
function Row({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
