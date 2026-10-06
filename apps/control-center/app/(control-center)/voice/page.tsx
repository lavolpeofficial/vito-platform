import './voice.css';
import { VoiceCommandCenter } from './voice-command-center';

export const metadata = { title: 'VITO Voice' };

export default function VoicePage() {
  return (
    <section className="voice-page" aria-labelledby="voice-title">
      <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>VITO Voice</span></div>
      <header className="voice-heading">
        <div>
          <span className="eyebrow">VOICE COMMAND CENTER · STAGING</span>
          <h1 id="voice-title">Sprich mit VITO.</h1>
          <p>Push-to-talk, sichtbares Transkript und hörbare Antworten. V1 bleibt read-only, bis ein Human Gate eine weitergehende Aktion freigibt.</p>
        </div>
        <span className="status-chip">SAFE MODE</span>
      </header>
      <VoiceCommandCenter />
    </section>
  );
}
