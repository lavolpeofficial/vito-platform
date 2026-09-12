export type NavigationItem = Readonly<{
  href: '/operations' | '/source-vault' | '/planning' | '/workflows' | '/workforce' | '/governance' | '/memory' | '/audit';
  label: string;
  description: string;
  icon: 'pulse' | 'vault' | 'planning' | 'workflow' | 'agents' | 'governance' | 'memory' | 'audit';
}>;

export const navigationItems: readonly NavigationItem[] = [
  { href: '/operations', label: 'Operations', description: 'Systemzustand und operative Lage', icon: 'pulse' },
  { href: '/source-vault', label: 'Source Vault', description: 'Quellen, Verarbeitung und Herkunft', icon: 'vault' },
  { href: '/planning', label: 'Goal & Planning', description: 'Ziele und governbare Pläne', icon: 'planning' },
  { href: '/workflows', label: 'Workflows', description: 'Abläufe, Freigaben und Ausführung', icon: 'workflow' },
  { href: '/workforce', label: 'Agents & Capabilities', description: 'Digitale Mitarbeiter und Befugnisse', icon: 'agents' },
  { href: '/governance', label: 'Governance & Reviews', description: 'Menschliche Freigaben und Review-Grenzen', icon: 'governance' },
  { href: '/memory', label: 'Memory Explorer', description: 'Aktive Erinnerungen und Provenienz', icon: 'memory' },
  { href: '/audit', label: 'Audit & Activity', description: 'Unveränderbare operative Evidenz', icon: 'audit' },
] as const;

export function isNavigationItemActive(pathname: string, href: NavigationItem['href']): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
