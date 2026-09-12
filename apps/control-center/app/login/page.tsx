import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { getAuthenticatedSession } from '@/lib/auth/session';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await getAuthenticatedSession()) redirect('/');

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-panel">
        <div className="login-brand"><span className="brand-mark">V</span><span><strong>VITO</strong><small>Control Center</small></span></div>
        <div className="login-copy"><span className="eyebrow">Authorized access only</span><h1 id="login-title">Sign in to your workforce.</h1><p>Your identity and organization are verified by the existing VITO security boundary.</p></div>
        <LoginForm />
        <p className="login-security-note">Credentials are forwarded to VITO only by the server-side auth route. The access token remains in an HttpOnly session cookie and is never exposed to browser JavaScript.</p>
      </section>
      <aside aria-label="VITO system principle" className="login-principle"><span>VITO · EXECUTION INTELLIGENCE</span><blockquote>“Execute approved decisions. Preserve authority, context and traceability.”</blockquote></aside>
    </main>
  );
}
