import Link from 'next/link';
import { ApplicationForm } from '@/components/application-form';
import { MountainMark } from '@/components/mountain';

export default function ApplyPage() {
  return (
    <main className="public-page">
      <header className="public-hero">
        <div><Link className="public-brand" href="/login">URTALI <span>SYSTEMS</span></Link><span className="eyebrow">Partner Application</span><h1>Gemeinsam höher.</h1><p>Bewirb dich für eine klar definierte Partnerrolle. Freigabe, Vertrag, Training und Autorisierung bleiben getrennte Schritte.</p></div>
        <MountainMark />
      </header>
      <ApplicationForm />
    </main>
  );
}
