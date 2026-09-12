import type { NavigationItem } from '@/lib/navigation';

type NavigationIconProps = Readonly<{ name: NavigationItem['icon'] }>;

export function NavigationIcon({ name }: NavigationIconProps) {
  const paths: Record<NavigationItem['icon'], React.ReactNode> = {
    pulse: <path d="M3 12h4l2.4-6 4.2 12 2.4-6h5" />,
    vault: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M7 5V3h10v2M7 10h10M8 14h8M9 18h6" /></>,
    planning: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4v6M12 12H8a2 2 0 0 0-2 2v4" /></>,
    workflow: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h4a4 4 0 0 1 4 4v5M15 18h-4a4 4 0 0 1-4-4V9" /></>,
    agents: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.5M17 15a4.5 4.5 0 0 1 3.5 4" /></>,
    governance: <><path d="M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  };

  return <svg aria-hidden="true" className="nav-icon" fill="none" viewBox="0 0 24 24"><g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">{paths[name]}</g></svg>;
}
