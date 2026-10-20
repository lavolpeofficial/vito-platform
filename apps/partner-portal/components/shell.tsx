'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { partner } from '@/lib/demo-data';

const nav = [
  ['/', 'Home', 'HE'],
  ['/academy', 'Academy', 'AC'],
  ['/solutions', 'Solutions', 'SO'],
  ['/sales', 'Sales Hub', 'SA'],
  ['/leads', 'Leads', 'LE'],
  ['/opportunities', 'Opportunities', 'OP'],
  ['/documents', 'Documents', 'DO'],
  ['/commissions', 'Commissions', 'CO'],
  ['/support', 'Support', 'SU'],
  ['/profile', 'Profile', 'PR'],
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <Link className="portal-brand" href="/">
          <strong>URTALI</strong>
          <span>SYSTEMS</span>
          <small>PARTNER</small>
        </Link>
        <nav className="portal-nav" aria-label="Partner navigation">
          {nav.map(([href, label, mark]) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className="portal-nav-link" aria-current={active ? 'page' : undefined}>
                <i>{mark}</i><span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="portal-sidebar-foot">
          <span className="status-dot" />
          <div><strong>Review Mode</strong><small>Keine Produktionsdaten</small></div>
        </div>
      </aside>
      <section className="portal-workspace">
        <header className="portal-topbar">
          <div>
            <span className="eyebrow">Partner Operating System</span>
            <Link className="topbar-search" href="/search">Search</Link><Link className="review-badge" href="/review">V1.1 REVIEW</Link>
          </div>
          <div className="partner-mini">
            <div><strong>{partner.fullName}</strong><small>{partner.role} · {partner.authorization}</small></div>
            <span className="avatar">AD</span>
          </div>
        </header>
        <main className="portal-main">{children}</main>
      </section>
    </div>
  );
}
