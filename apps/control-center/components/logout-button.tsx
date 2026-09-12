'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return <button className="logout-button" disabled={submitting} onClick={logout} type="button">{submitting ? 'Signing out…' : 'Sign out'}</button>;
}
