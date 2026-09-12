'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navigationItems, isNavigationItemActive } from '@/lib/navigation';
import { NavigationIcon } from './navigation-icon';

export function ShellNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Control Center Bereiche" className="shell-nav">
      {navigationItems.map((item) => {
        const active = isNavigationItemActive(pathname, item.href);
        return (
          <Link aria-current={active ? 'page' : undefined} className="nav-link" href={item.href} key={item.href}>
            <NavigationIcon name={item.icon} />
            <span><strong>{item.label}</strong><small>{item.description}</small></span>
          </Link>
        );
      })}
    </nav>
  );
}
