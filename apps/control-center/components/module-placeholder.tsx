import Link from 'next/link';
import type { NavigationItem } from '@/lib/navigation';
import { NavigationIcon } from './navigation-icon';

type ModulePlaceholderProps = Readonly<{ item: NavigationItem; sequence: number; outcome: string }>;

export function ModulePlaceholder({ item, sequence, outcome }: ModulePlaceholderProps) {
  return (
    <section aria-labelledby="module-title" className="module-page">
      <div className="breadcrumb"><Link href="/">Control Center</Link><span aria-hidden="true">/</span><span>{item.label}</span></div>
      <div className="module-heading">
        <span className="module-icon"><NavigationIcon name={item.icon} /></span>
        <div><span className="eyebrow">Block {sequence}</span><h1 id="module-title">{item.label}</h1><p>{item.description}</p></div>
      </div>
      <div className="empty-state">
        <span className="status-chip">Route ready</span>
        <h2>Module boundary established</h2>
        <p>{outcome}</p>
        <p className="scope-note">This shell does not request backend data yet. Authentication, tenant context and the API client are introduced in their dedicated blocks.</p>
      </div>
    </section>
  );
}
