'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { demoLeads } from '@/lib/demo-data';

type StoredLead = { id: string; company: string; status: string; protection: string; nextAction: string };

export function LeadTable() {
  const [created, setCreated] = useState<StoredLead[]>([]);
  useEffect(() => {
    try {
      setCreated(JSON.parse(localStorage.getItem('urtali-partner-review-leads') || '[]'));
    } catch {
      setCreated([]);
    }
  }, []);

  return (
    <div className="table-card">
      <div className="table-head"><strong>Meine Leads</strong><Link className="button primary small" href="/leads/new">+ Lead registrieren</Link></div>
      <div className="data-table">
        <div className="data-row data-header"><span>Company</span><span>Status</span><span>Schutzfrist</span><span>Nächste Aktion</span></div>
        {[...created, ...demoLeads].map((lead) => (
          <div className="data-row" key={lead.id}>
            <strong>{lead.company}</strong>
            <span><b className={'stage stage-' + lead.status.toLowerCase()}>{lead.status}</b></span>
            <span>{lead.protection}</span>
            <span>{lead.nextAction}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
