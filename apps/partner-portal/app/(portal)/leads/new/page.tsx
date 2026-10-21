import Link from 'next/link';
import { LeadRegistrationForm } from '@/components/lead-registration-form';

export default function NewLeadPage() {
  return (
    <>
      <div className="breadcrumb"><Link href="/leads">Leads</Link><span>→</span><span>Neuer Lead</span></div>
      <header className="page-head compact-head">
        <span className="eyebrow">Lead Registration</span>
        <h1>Lead registrieren</h1>
        <p>Company, Kontaktbasis und bekannter Bedarf. Die Zentrale entscheidet über Annahme, Konflikte und Schutzfrist.</p>
      </header>
      <LeadRegistrationForm />
    </>
  );
}
