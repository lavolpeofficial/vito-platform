import { LeadTable } from '@/components/lead-table';

export default function LeadsPage() {
  return (
    <>
      <header className="page-head">
        <span className="eyebrow">Revenue</span>
        <h1>Leads</h1>
        <p>Registrierung, Schutzfrist und Konfliktprüfung. Schutz entsteht erst nach Annahme durch die Zentrale.</p>
      </header>
      <LeadTable />
    </>
  );
}
