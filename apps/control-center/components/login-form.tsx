'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSubmitting(true);
    setError(null);
    const form = new FormData(formElement);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationSlug: form.get('organizationSlug'),
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error || 'Login failed.');
        return;
      }
      formElement.reset();
      router.replace('/');
      router.refresh();
    } catch {
      setError('The Control Center could not reach the identity service.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <label htmlFor="organizationSlug">Organization</label>
      <input autoCapitalize="none" autoComplete="organization" id="organizationSlug" maxLength={60} name="organizationSlug" placeholder="organization-slug" required spellCheck={false} />

      <label htmlFor="email">Email</label>
      <input autoCapitalize="none" autoComplete="username" id="email" maxLength={320} name="email" placeholder="name@organization.com" required spellCheck={false} type="email" />

      <label htmlFor="password">Password</label>
      <input autoComplete="current-password" id="password" maxLength={200} name="password" required type="password" />

      {error ? <p aria-live="polite" className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={submitting} type="submit">{submitting ? 'Verifying…' : 'Enter Control Center'}</button>
    </form>
  );
}
