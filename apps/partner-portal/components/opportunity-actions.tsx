'use client';

import { useState } from 'react';

export function OpportunityActions({ company }: { company: string }) {
  const [message, setMessage] = useState<string | null>(null);

  function simulate(action: string) {
    setMessage(action + ' für ' + company + ' wurde im Review Mode simuliert. Keine API-Aktion wurde ausgeführt.');
  }

  return (
    <div className="opportunity-actions">
      <button className="button primary" type="button" onClick={() => simulate('Proposal Request')}>Proposal anfordern</button>
      <button className="button secondary" type="button" onClick={() => simulate('ADOREN Invite')}>ADOREN senden</button>
      <button className="button secondary" type="button" onClick={() => simulate('Discount Review')}>Preisabweichung beantragen</button>
      {message && <div className="success-box">{message}</div>}
    </div>
  );
}
