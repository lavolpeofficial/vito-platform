import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'VITO Control Center', template: '%s · VITO Control Center' },
  description: 'Internal control surface for the VITO Digital Workforce Platform.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
