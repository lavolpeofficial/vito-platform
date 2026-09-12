import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AuthenticatedSession } from '@/lib/auth/contracts';
import { LogoutButton } from './logout-button';
import { ShellNavigation } from './shell-navigation';

type AppShellProps = Readonly<{ children: ReactNode; session: AuthenticatedSession }>;

export function AppShell({ children, session }: AppShellProps) {
  const displayName = [session.user.firstName, session.user.lastName].filter(Boolean).join(' ');
  const initials = `${session.user.firstName.at(0) ?? ''}${session.user.lastName.at(0) ?? ''}` || 'U';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link aria-label="VITO Control Center Startseite" className="brand" href="/">
          <span className="brand-mark">V</span>
          <span><strong>VITO</strong><small>Control Center</small></span>
        </Link>
        <div className="sidebar-section-label">Steuerung</div>
        <ShellNavigation />
        <div className="sidebar-footer">
          <span className="system-dot" />
          <span><strong>{session.organization.name}</strong><small>Tenant active</small></span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">Execution Intelligence</span><span className="environment-badge">Internal</span></div>
          <div aria-label="Aktueller Zugriffskontext" className="context-state">
            <span className="context-avatar">{initials.toUpperCase()}</span>
            <span><strong>{displayName}</strong><small>{session.user.role} · {session.organization.slug}</small></span>
            <LogoutButton />
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
