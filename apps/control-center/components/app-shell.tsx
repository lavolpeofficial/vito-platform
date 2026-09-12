import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShellNavigation } from './shell-navigation';

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
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
          <span><strong>Internal workspace</strong><small>Shell v1</small></span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div><span className="eyebrow">Execution Intelligence</span><span className="environment-badge">Internal</span></div>
          <div aria-label="Aktueller Zugriffskontext" className="context-state">
            <span className="context-avatar">—</span>
            <span><strong>No active session</strong><small>Auth & tenant context follows in block 2</small></span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
