import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AcademyQuiz } from '@/components/academy-quiz';
import { academyModules } from '@/lib/demo-data';

const notes: Record<string, string[]> = {
  A01: ['LA VOLPE ist der operative Rahmen und Vertragspartner.', 'URTALI ist Technologie- und Systemmarke.', 'VITO orchestriert, ADOREN orientiert, DIGITALIS löst Prozess- und Digitalisierungsfälle.'],
  A02: ['ADOREN beginnt bei der Situation, nicht beim Produkt.', 'ENTRY ist nicht gleich SCOPE.', 'Partner sehen nur freigegebene B2B-Zusammenfassungen.'],
  A03: ['Nicht Druck, sondern Zug.', 'Keine Lösung vor dem Verständnis des Problems.', 'NO_ACTION und INTERNAL_ACTION sind valide Ergebnisse.'],
  A04: ['Need, Impact, Clarity, Readiness, Decision Access und Fit getrennt bewerten.', 'Keine pseudoexakte Gesamtnote erzwingen.', 'Qualification bestimmt den nächsten sinnvollen Pfad.'],
};

export default async function AcademyModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const module = academyModules.find((entry) => entry.id === id);
  if (!module) notFound();
  const moduleNotes = notes[id] ?? ['Modulinhalt ist für die Review-Struktur vorbereitet.', 'Finale Videos und Handouts werden nach Owner-Abnahme versioniert veröffentlicht.'];

  return (
    <>
      <div className="breadcrumb"><Link href="/academy">Academy</Link><span>→</span><span>{module.id}</span></div>
      <header className="page-head compact-head"><span className="eyebrow">{module.id} · {module.minutes} Min</span><h1>{module.title}</h1><p>Video, Handout, Praxisbeispiel und kurzer Wissenstest bilden eine Einheit.</p></header>
      <section className="academy-detail-grid">
        <article className="video-slot"><div className="play-mark">▶</div><strong>Video Slot · {module.title}</strong><small>Review-Platzhalter · kein externes Video eingebunden</small></article>
        <article className="panel"><span className="eyebrow">Kernpunkte</span><ul className="learning-list">{moduleNotes.map((note) => <li key={note}>{note}</li>)}</ul><button className="button secondary" type="button" disabled>Handout · nach Content-Freigabe</button></article>
      </section>
      <AcademyQuiz />
    </>
  );
}
