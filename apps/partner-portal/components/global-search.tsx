'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { academyModules, documents, opportunities, solutions } from '@/lib/demo-data';

const items = [
  ...academyModules.map((item) => ({ kind: 'Academy', title: item.title, meta: item.id, href: '/academy/' + item.id })),
  ...solutions.map((item) => ({ kind: 'Solution', title: item.name, meta: item.label, href: '/solutions' })),
  ...documents.map((item) => ({ kind: 'Document', title: item.title, meta: item.category + ' · v' + item.version, href: '/documents' })),
  ...opportunities.map((item) => ({ kind: 'Opportunity', title: item.company, meta: item.stage + ' · ' + item.primaryPath, href: '/opportunities/' + item.id })),
];

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 8);
    return items.filter((item) => (item.title + ' ' + item.meta + ' ' + item.kind).toLowerCase().includes(q)).slice(0, 20);
  }, [query]);

  return (
    <section className="search-surface">
      <label className="search-box">Suche<input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Academy, Angebot, Dokument, Opportunity …" /></label>
      <div className="search-results">
        {results.map((item) => <Link href={item.href} key={item.kind + item.title}><span>{item.kind}</span><div><strong>{item.title}</strong><small>{item.meta}</small></div><b>→</b></Link>)}
        {results.length === 0 && <div className="empty-search">Keine Treffer in den Review-Daten.</div>}
      </div>
    </section>
  );
}
