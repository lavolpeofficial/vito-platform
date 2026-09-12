import './memory.css';
import { MemoryClient } from './memory-client';

export const metadata = { title: 'Memory Explorer' };

export default function MemoryPage() {
  return <main>
    <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Memory Explorer</span></div>
    <section className="module-heading"><div className="module-icon">ME</div><div><span className="eyebrow">Evidence-backed organizational memory</span><h1>Memory Explorer</h1><p>Durchsuche VITOs aktive, tenant-scoped Memory Entries über den bestehenden PostgreSQL Memory Service.</p></div></section>
    <div className="boundary-notice"><span className="system-dot" /><div><strong>Read-only Control Center surface</strong><p>Diese Sicht zeichnet keine Erinnerungen auf und retractet keine Einträge. Retrieval, Ranking, Tenant- und Scope-Grenzen bleiben ausschließlich Backend-Verantwortung.</p></div></div>
    <MemoryClient />
  </main>;
}
