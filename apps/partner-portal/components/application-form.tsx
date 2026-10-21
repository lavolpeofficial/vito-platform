'use client';

import { FormEvent, useState } from 'react';

export function ApplicationForm() {
  const [done, setDone] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(true);
    event.currentTarget.reset();
  }

  return (
    <form className="lead-form apply-form" onSubmit={submit}>
      <div className="review-notice"><strong>Review Mode</strong><p>Die Bewerbung wird in dieser Version nicht übertragen oder gespeichert.</p></div>
      <div className="form-grid">
        <label>Name<input required name="name" /></label>
        <label>Unternehmen<input name="organization" /></label>
        <label>Land<input required name="country" defaultValue="Italia" /></label>
        <label>Region<input name="region" /></label>
        <label>Sprachen<input name="languages" defaultValue="Italiano, Deutsch" /></label>
        <label>Gewünschte Rolle<select name="role" defaultValue="SCOUT"><option>SCOUT</option><option>SALES_PARTNER</option><option>PARTNER_RECRUITER</option><option>BUSINESS_PARTNER</option></select></label>
        <label className="wide">Sales-/Beratungserfahrung<textarea rows={4} name="experience" /></label>
        <label className="wide">Branchen & Netzwerk<textarea rows={3} name="network" /></label>
        <label className="wide">Warum URTALI?<textarea rows={3} name="motivation" /></label>
      </div>
      <label className="check"><input required type="checkbox" /> Ich bestätige die Review-Datenschutzhinweise.</label>
      <button className="button primary" type="submit">Bewerbung simulieren</button>
      {done && <div className="success-box">Review erfolgreich: Zielstatus wäre SUBMITTED → UNDER_REVIEW. Es wurden keine Daten übertragen.</div>}
    </form>
  );
}
