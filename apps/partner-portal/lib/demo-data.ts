import type { AuthorizationLevel, PortfolioPermission } from './domain';

export type OpportunityStage =
  | 'PROSPECT' | 'CONTACTED' | 'ADOREN_INVITED' | 'ADOREN_COMPLETED'
  | 'QUALIFIED' | 'DISCOVERY' | 'SOLUTION_DEFINED' | 'PROPOSAL_SENT'
  | 'NEGOTIATION' | 'WON' | 'DELIVERY' | 'CARE' | 'NURTURE' | 'LOST';

export const partner = {
  name: 'Alessandro',
  fullName: 'Alessandro De Rosa',
  role: 'Sales Partner',
  organization: 'LA VOLPE',
  authorization: 'SALES_ALLOWED' as AuthorizationLevel,
  academyProgress: 78,
  language: 'DE / IT',
};

export const metrics = {
  activeLeads: 12,
  opportunities: 4,
  pipeline: 28500,
  adorePending: 2,
  commissionPending: 820,
  commissionEligible: 1460,
  paidYtd: 4320,
  tasksToday: 3,
};

export const academyModules = [
  { id: 'A01', title: 'URTALI & LA VOLPE', minutes: 8, status: 'COMPLETED' },
  { id: 'A02', title: 'ADOREN', minutes: 10, status: 'COMPLETED' },
  { id: 'A03', title: 'Nicht Druck, sondern Zug', minutes: 8, status: 'COMPLETED' },
  { id: 'A04', title: 'Qualification', minutes: 15, status: 'IN_PROGRESS' },
  { id: 'A05', title: 'Routing', minutes: 15, status: 'AVAILABLE' },
  { id: 'A06', title: 'Offers & Portfolio', minutes: 20, status: 'AVAILABLE' },
  { id: 'A07', title: 'Akquise', minutes: 15, status: 'AVAILABLE' },
  { id: 'A08', title: 'Discovery', minutes: 20, status: 'LOCKED' },
  { id: 'A09', title: 'Pricing & Governance', minutes: 10, status: 'LOCKED' },
  { id: 'A10', title: 'CRM & Lead Protection', minutes: 10, status: 'LOCKED' },
  { id: 'A11', title: 'Compliance', minutes: 15, status: 'LOCKED' },
  { id: 'A12', title: 'Proposal & Handoff', minutes: 10, status: 'LOCKED' },
] as const;

export const solutions: Array<{
  id: string;
  name: string;
  label: string;
  problem: string;
  price: string;
  target: string;
  permission: PortfolioPermission;
  useWhen: string;
  avoidWhen: string;
  next: string;
}> = [
  {
    id: 'adore-business',
    name: 'ADOREN Business Orientation',
    label: 'Orientierung',
    problem: 'Mehrere Themen hängen zusammen und die erste Priorität ist noch unklar.',
    price: '€1.500–3.500',
    target: '€2.000–2.750',
    permission: 'SALES_ALLOWED',
    useWhen: 'Unternehmenslage bereichsübergreifend und Prioritäten unklar.',
    avoidWhen: 'Ein konkreter Prozessengpass bereits eindeutig beschrieben ist.',
    next: 'Internal Action · DIGITALIS Discovery · BRIDGE · SELECTA',
  },
  {
    id: 'digitalis-discovery',
    name: 'DIGITALIS Discovery',
    label: 'Discovery',
    problem: 'Ein konkreter Engpass ist bekannt, Ursache oder Lösung aber noch nicht ausreichend definiert.',
    price: '€2.500–5.000',
    target: '€3.000–4.000',
    permission: 'SALES_ALLOWED',
    useWhen: 'Ein operativer Prozessbereich bekannt ist, aber Zielprozess oder Anforderungen fehlen.',
    avoidWhen: 'Die Lage noch völlig unspezifisch ist.',
    next: 'Automation · Internal Action · Standardlösung',
  },
  {
    id: 'digitalis-automation',
    name: 'DIGITALIS Automation',
    label: 'Automation',
    problem: 'Ein klarer, wiederkehrender Prozess soll digitalisiert, integriert oder automatisiert werden.',
    price: '€7.500–25.000+',
    target: 'Scope-basiert',
    permission: 'REFERRAL_ONLY',
    useWhen: 'Prozess, Nutzen, Rollen und Datenlage ausreichend klar sind.',
    avoidWhen: 'Ein instabiler Prozess nur technisch kaschiert werden soll.',
    next: 'CARE · URTALI Systems',
  },
  {
    id: 'urtali-systems',
    name: 'URTALI Systems Project',
    label: 'Custom Systems',
    problem: 'Mehrere Systeme, eigene Rollen, Datenmodelle oder individuelle Plattformlogik werden benötigt.',
    price: '€15.000–50.000+',
    target: 'Architekturabhängig',
    permission: 'REFERRAL_ONLY',
    useWhen: 'Die Aufgabe über eine normale Automation hinausgeht.',
    avoidWhen: 'Eine etablierte Standardlösung wirtschaftlich klar besser passt.',
    next: 'CARE · Licensing',
  },
];

export const demoLeads = [
  { id: 'lead-auto-royal', company: 'Auto Royal Group', status: 'ACCEPTED', protection: '18.01.2027', nextAction: 'Follow-up heute' },
  { id: 'lead-villa-calabria', company: 'Villa Calabria', status: 'REVIEW', protection: '—', nextAction: 'Informationen ergänzen' },
  { id: 'lead-bianchi', company: 'Bianchi Costruzioni', status: 'ACCEPTED', protection: '02.02.2027', nextAction: 'ADOREN senden' },
  { id: 'lead-hotel', company: 'Hotel Belvedere', status: 'NURTURE', protection: '—', nextAction: 'Review im Dezember' },
];

export const opportunities = [
  {
    id: 'auto-royal',
    company: 'Auto Royal Group',
    stage: 'DISCOVERY' as OpportunityStage,
    value: 12900,
    primaryPath: 'DIGITALIS Automation',
    nextAction: 'Discovery Call',
    due: '22.10.2026',
    partnerRole: 'Sales Partner',
    need: 'HIGH', impact: 'HIGH', clarity: 'HIGH', readiness: 'HIGH', fit: 'HIGH',
  },
  {
    id: 'abc-srl',
    company: 'ABC SRL',
    stage: 'PROPOSAL_SENT' as OpportunityStage,
    value: 3500,
    primaryPath: 'DIGITALIS Discovery',
    nextAction: 'Proposal Follow-up',
    due: '24.10.2026',
    partnerRole: 'Scout',
    need: 'HIGH', impact: 'MEDIUM', clarity: 'MEDIUM', readiness: 'MEDIUM', fit: 'HIGH',
  },
  {
    id: 'hotel-mare',
    company: 'Hotel Mare',
    stage: 'QUALIFIED' as OpportunityStage,
    value: 2750,
    primaryPath: 'ADOREN Business Orientation',
    nextAction: 'Termin vereinbaren',
    due: '27.10.2026',
    partnerRole: 'Sales Partner',
    need: 'MEDIUM', impact: 'MEDIUM', clarity: 'LOW', readiness: 'MEDIUM', fit: 'HIGH',
  },
  {
    id: 'lago-resort',
    company: 'Lago Resort',
    stage: 'NURTURE' as OpportunityStage,
    value: 4500,
    primaryPath: 'DIGITALIS Discovery',
    nextAction: 'Review Q1',
    due: '15.01.2027',
    partnerRole: 'Scout',
    need: 'MEDIUM', impact: 'MEDIUM', clarity: 'MEDIUM', readiness: 'LOW', fit: 'HIGH',
  },
];

export const commissions = [
  { opportunity: 'ABC SRL', cnr: 5000, rate: 8, amount: 400, status: 'PAID' },
  { opportunity: 'XYZ Auto', cnr: 10000, rate: 12, amount: 1200, status: 'ELIGIBLE' },
  { opportunity: 'Hotel Mare', cnr: 3000, rate: 15, amount: 450, status: 'PENDING' },
  { opportunity: 'Lago Resort', cnr: 4500, rate: 8, amount: 360, status: 'CALCULATED' },
];

export const documents = [
  { title: 'Partner Guide', version: '1.2', type: 'PDF', category: 'START HERE', language: 'DE', status: 'APPROVED' },
  { title: 'B2B Sales Operating System', version: '1.0', type: 'PDF', category: 'SALES', language: 'DE', status: 'APPROVED' },
  { title: 'DIGITALIS Discovery Offer Card', version: '1.1', type: 'PDF', category: 'DIGITALIS', language: 'IT', status: 'APPROVED' },
  { title: 'Lead Protection Policy', version: '1.0', type: 'PDF', category: 'LEGAL', language: 'DE', status: 'APPROVED' },
  { title: 'URTALI Brand Assets', version: '1.0', type: 'ZIP', category: 'BRAND', language: 'ALL', status: 'APPROVED' },
];
