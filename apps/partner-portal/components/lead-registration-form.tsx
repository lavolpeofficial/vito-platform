'use client';

import { FormEvent, useState } from 'react';

export function LeadRegistrationForm() {
  const [result, setResult] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const company = String(form.get('company') || '').trim();
    if (!company) return;
    const lead = {
      id: 'review-' + Date.now(),
      company,
      status: 'REVIEW',
      protection: '—',
      nextAction: 'Zentrale Prüfung',
    };
    const current = JSON.parse(localStorage.getItem('urtali-partner-review-leads') || '[]');
    localStorage.setItem('urtali-partner-review-leads', JSON.stringify([lead, ...current]));
    setResult('Lead wurde nur lokal im Review-Browser gespeichert. Keine Kundendaten wurden übertragen.');
    event.currentTarget.reset();
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="review-notice"><strong>Review Mode</strong><p>Diese Maske speichert Testeinträge ausschließlich lokal im Browser. Keine Produktions-API ist verbunden.</p></div>
      <div className="form-grid">
        <label>Company Name<input name="company" required /></label>
        <label>Website<input name="website" type="url" /></label>
        <label>Country<select name="country" defaultValue="IT"><option value="IT">Italia</option><option value="DE">Deutschland</option></select></label>
        <label>City<input name="city" /></label>
        <label>Industry<input name="industry" /></label>
        <label>Contact Name<input name="contact" /></label>
        <label>Contact Role<input name="role" /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Contact Basis<select name="basis" defaultValue="public"><option value="public">Public business contact</option><option value="network">Personal network</option><option value="referral">Referral</option><option value="inbound">Inbound request</option></select></label>
        <label>Source<select name="source" defaultValue="DIRECT"><option>DIRECT</option><option>SCOUT</option><option>REFERRAL</option><option>EVENT</option></select></label>
        <label className="wide">Known Need<textarea name="need" rows={4} /></label>
        <label className="wide">Notes<textarea name="notes" rows={3} /></label>
      </div>
      <label className="check"><input type="checkbox" required /> Ich bestätige, nur geschäftlich erforderliche Testdaten zu verwenden.</label>
      <button className="button primary" type="submit">Lead zur Review-Liste hinzufügen</button>
      {result && <div className="success-box">{result}</div>}
    </form>
  );
}
