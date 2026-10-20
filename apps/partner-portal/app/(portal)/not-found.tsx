import Link from 'next/link';

export default function NotFound() {
  return <section className="not-found"><span className="eyebrow">404</span><h1>Nicht gefunden.</h1><p>Dieser Review-Datensatz existiert nicht.</p><Link className="button primary" href="/">Zum Dashboard</Link></section>;
}
