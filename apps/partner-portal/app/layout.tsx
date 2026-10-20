import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'URTALI Partner', template: '%s · URTALI Partner' },
  description: 'Partner Operating System for the URTALI / LA VOLPE ecosystem.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="de"><body>{children}</body></html>;
}
