'use client';

import { useEffect, useRef, useState } from 'react';

type RecognitionResultEvent = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionConstructor = new () => Recognition;

type VoiceWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

type OperationsSummary = {
  workflows: { total: number; attentionCount: number };
  workforce: { total: number };
  governance: { pendingSkillPromotionReviews: number };
};

export function VoiceCommandCenter() {
  const [transcript, setTranscript] = useState('');
  const [assistantText, setAssistantText] = useState('Bereit. Sag „Vito, Status“ oder schreibe einen Befehl.');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  useEffect(() => {
    const voiceWindow = window as VoiceWindow;
    setSupported(Boolean(voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  function startListening() {
    const voiceWindow = window as VoiceWindow;
    const Constructor = voiceWindow.SpeechRecognition || voiceWindow.webkitSpeechRecognition;
    if (!Constructor || listening) return;

    const recognition = new Constructor();
    recognition.lang = 'de-DE';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        parts.push(event.results[index][0].transcript);
      }
      setTranscript(parts.join(' ').trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setAssistantText('Die Browser-Spracherkennung konnte nicht gestartet werden. Du kannst den Satz unten eintippen.');
    };
    recognitionRef.current = recognition;
    setTranscript('');
    setListening(true);
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function submitCommand(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    const command = transcript.trim();
    if (!command || busy) return;

    setBusy(true);
    if (isStatusRequest(command)) {
      try {
        const response = await fetch('/api/voice/status', { method: 'POST', headers: { Accept: 'application/json' } });
        const payload = await response.json() as { summary?: OperationsSummary; message?: string };
        if (!response.ok || !payload.summary) throw new Error(payload.message || 'STATUS_UNAVAILABLE');
        const summary = payload.summary;
        const spoken = 'Status: ' + summary.workflows.total + ' Workflows, ' + summary.workforce.total + ' Digital Employees und ' + summary.workflows.attentionCount + ' Vorgänge in der Aufmerksamkeitsliste. ' + summary.governance.pendingSkillPromotionReviews + ' Governance-Reviews warten.';
        setAssistantText(spoken);
        speak(spoken);
      } catch {
        const message = 'Der Read-only-Status ist gerade nicht verfügbar. VITO hat nichts ausgeführt.';
        setAssistantText(message);
        speak(message);
      } finally {
        setBusy(false);
      }
      return;
    }

    const blocked = 'Human Gate: Diese Absicht ist in V1 nicht freigegeben. Es wurde nichts ausgeführt.';
    setAssistantText(blocked);
    speak(blocked);
    setBusy(false);
  }

  return (
    <div className="voice-center">
      <div className="voice-panel voice-transcript-panel">
        <div className="voice-panel-heading"><div><span className="eyebrow">01 · INPUT</span><h2>Was soll VITO wissen?</h2></div><span className="status-chip">{listening ? 'LISTENING' : 'IDLE'}</span></div>
        <form onSubmit={submitCommand}>
          <label className="voice-label" htmlFor="voice-transcript">Transkript / Befehl</label>
          <textarea id="voice-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Vito, Status" rows={4} />
          <div className="voice-actions">
            <button className={listening ? 'voice-button voice-button-active' : 'voice-button'} type="button" onClick={listening ? stopListening : startListening} disabled={busy}>
              {listening ? 'Stoppen' : 'Sprechen'}
            </button>
            <button className="primary-button voice-submit" type="submit" disabled={busy || !transcript.trim()}>{busy ? 'Prüfe…' : 'An VITO senden'}</button>
          </div>
        </form>
        <p className="voice-support">{supported === null ? 'Prüfe Browser-Mikrofon…' : supported ? 'Browser-Spracherkennung verfügbar.' : 'Spracherkennung nicht verfügbar — Texteingabe bleibt aktiv.'}</p>
      </div>

      <div className="voice-panel voice-response-panel">
        <div className="voice-panel-heading"><div><span className="eyebrow">02 · RESPONSE</span><h2>VITO antwortet</h2></div><span className="system-dot" /></div>
        <p className="voice-response" aria-live="polite">{assistantText}</p>
        <div className="voice-boundary"><strong>Aktive Grenze</strong><span>Read-only Status · Human Gate für alles Weitere</span></div>
      </div>

      <div className="voice-panel voice-command-panel">
        <div className="voice-panel-heading"><div><span className="eyebrow">03 · EXAMPLES</span><h2>Jetzt testen</h2></div></div>
        <div className="voice-examples">
          <button type="button" onClick={() => setTranscript('Vito, Status')}>Vito, Status</button>
          <button type="button" onClick={() => setTranscript('Wie ist die Lage?')}>Wie ist die Lage?</button>
          <button type="button" onClick={() => setTranscript('Deploy ADOREN')}>Deploy ADOREN <span>→ Human Gate</span></button>
        </div>
      </div>
    </div>
  );
}

function isStatusRequest(value: string): boolean {
  return /\b(status|lage|zustand|überblick|ueberblick)\b/i.test(value);
}

function speak(value: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value);
  utterance.lang = 'de-DE';
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}
