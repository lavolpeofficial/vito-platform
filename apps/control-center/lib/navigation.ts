export type NavigationItem = Readonly<{
  href: '/operations' | '/source-vault' | '/workflows' | '/workforce' | '/governance';
  label: string;
  description: string;
  icon: 'pulse' | 'vault' | 'workflow' | 'agents' | 'governance';
}>;

export const navigationItems: readonly NavigationItem[] = [
  { href: '/operations', label: 'Operations', description: 'Systemzustand und operative Lage', icon: 'pulse' },
  { href: '/source-vault', label: 'Source Vault', description: 'Quellen, Verarbeitung und Herkunft', icon: 'vault' },
  { href: '/workflows', label: 'Workflows', description: 'Abläufe, Freigaben und Ausführung', icon: 'workflow' },
  { href: '/workforce', label: 'Agents & Capabilities', description: 'Digitale Mitarbeiter und Befugnisse', icon: 'agents' },
  { href: '/governance', label: 'Governance & Reviews', description: 'Menschliche Freigaben und Review-Grenzen', icon: 'governance' },
] as const;

export function isNavigationItemActive(pathname: string, href: NavigationItem['href']): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
