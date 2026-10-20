import Link from 'next/link';
import { MountainMark } from '@/components/mountain';

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-copy">
        <div className="login-brand"><strong>URTALI</strong><span>SYSTEMS</span><small>PARTNER</small></div>
        <div>
          <span className="eyebrow">Partner Operating System</span>
          <h1>Gemeinsam höher.</h1>
          <p>Klar orientieren. Professionell handeln. Nachhaltig wachsen.</p>
        </div>
        <div className="review-notice"><strong>Review Build</strong><p>Auth0 EU ist bewusst noch nicht verbunden. Diese Oberfläche dient der Owner-Kontrolle ohne produktive Identitäts- oder Kundendaten.</p></div>
        <div className="login-actions"><Link className="button primary login-button" href="/">Review Portal öffnen</Link><Link className="button secondary login-button" href="/apply">Partner werden</Link></div>
      </section>
      <section className="login-mountain"><MountainMark /><blockquote>UNDERSTAND<br />TRANSFORM<br />EVOLVE</blockquote></section>
    </main>
  );
}
