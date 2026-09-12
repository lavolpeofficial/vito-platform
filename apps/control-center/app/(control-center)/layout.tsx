import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { TenantContextProvider } from '@/components/tenant-context';
import { getAuthenticatedSession } from '@/lib/auth/session';

export default async function ControlCenterLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getAuthenticatedSession();
  if (!session) redirect('/login');

  return (
    <TenantContextProvider session={session}>
      <AppShell session={session}>{children}</AppShell>
    </TenantContextProvider>
  );
}
