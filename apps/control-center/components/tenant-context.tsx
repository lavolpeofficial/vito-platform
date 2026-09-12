'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AuthenticatedSession } from '@/lib/auth/contracts';

const TenantContext = createContext<AuthenticatedSession | null>(null);

export function TenantContextProvider({ children, session }: Readonly<{ children: ReactNode; session: AuthenticatedSession }>) {
  return <TenantContext.Provider value={session}>{children}</TenantContext.Provider>;
}

export function useTenantContext(): AuthenticatedSession {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenantContext must be used inside TenantContextProvider.');
  return context;
}
