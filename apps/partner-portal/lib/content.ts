export type ContentSection = Readonly<{ heading: string; body: readonly string[] }>;
export type PortalContent = Readonly<{
  slug: string;
  title: string;
  kind: 'DOCUMENT' | 'SALES_ASSET';
  category: string;
  language: string;
  version: string;
  status: 'APPROVED_REVIEW' | 'DRAFT_REVIEW';
  summary: string;
  sections: readonly ContentSection[];
}>;

export const knowledgeDocuments: readonly PortalContent[] = [
  {
    slug: 'partner-guide',
    title: 'URTALI Partner Guide',
    kind: 'DOCUMENT',
    category: 'START HERE',
    language: 'DE',
    version: '1.1',
    status: 'APPROVED_REVIEW',
    summary: 'Rollen, Lifecycle, Autorisierung, Lead Protection und Arbeitsprinzipien.',
    sections: [
      { heading: 'Grundprinzip', body: ['Nicht Druck, sondern Zug.', 'Keine Lösung vor dem Verständnis des Problems.', 'Partnerstatus bedeutet nicht automatisch Verkaufsbefugnis.'] },
      { heading: 'Partner Lifecycle', body: ['APPLY → SCREEN → APPROVE → CONTRACT → VERIFY → TRAIN → CERTIFY → AUTHORIZE → ACTIVATE → PRODUCE → REVIEW → DEVELOP → OFFBOARD.'] },
      { heading: 'Rollen', body: ['Scout: Kontakt eröffnen und Lead registrieren.', 'Sales Partner: nur freigegebene Angebote innerhalb der Authorization verkaufen.', 'Partner Recruiter: geeignete Partner gewinnen; kein Downline-Modell.'] },
      { heading: 'Opportunity', body: ['Jede aktive Opportunity hat einen Owner, eine Stage, einen Primary Path und eine Next Action mit Datum.'] },
    ],
  },
  {
    slug: 'commission-policy',
    title: 'Commission Policy',
    kind: 'DOCUMENT',
    category: 'LEGAL / COMMERCIAL',
    language: 'DE',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Transparente Partnervergütung auf vereinnahmtem CNR.',
    sections: [
      { heading: 'Grundlage', body: ['Provision entsteht nicht bei Lead-Registrierung und nicht allein bei Unterschrift, sondern auf tatsächlich eligible Collected Net Revenue (CNR).'] },
      { heading: 'Standardsätze', body: ['Scout: 8 % CNR.', 'Sales Partner mit eigenem Lead: 15 % CNR.', 'Scout + separater Sales Partner: 8 % + 12 % = maximal 20 % Projektpool.', 'Gleiche Person bringt und verkauft: 15 % total.'] },
      { heading: 'Lifecycle', body: ['CALCULATED → PENDING_PAYMENT → ELIGIBLE → APPROVED → PAID; bei Rückabwicklung ggf. REVERSED.'] },
      { heading: 'Abgrenzung', body: ['Invoice ≠ Payment ≠ Eligible CNR ≠ Commission Ledger.'] },
    ],
  },
  {
    slug: 'lead-protection-policy',
    title: 'Lead Protection Policy',
    kind: 'DOCUMENT',
    category: 'LEGAL / SALES',
    language: 'DE',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Regeln für Registrierung, Annahme, Konflikte und Schutzfrist.',
    sections: [
      { heading: 'Entstehung', body: ['Lead Protection entsteht erst nach zentralem ACCEPTED-Status, nicht bereits bei SUBMITTED.'] },
      { heading: 'Dauer', body: ['90 Tage Standard.', 'Einmalige Verlängerung um bis zu weitere 90 Tage bei dokumentierter Aktivität.', 'Maximal 180 Tage.'] },
      { heading: 'Konflikte', body: ['Bestehender Kunde, bestehende Opportunity, Dublette oder Schutz eines anderen Partners führen zu Review oder Ablehnung.'] },
      { heading: 'Nachweis', body: ['Entscheidung und Begründung werden auditiert; Partner kann Verlängerung beantragen, aber nicht selbst genehmigen.'] },
    ],
  },
  {
    slug: 'code-of-conduct',
    title: 'Partner Code of Conduct',
    kind: 'DOCUMENT',
    category: 'GOVERNANCE',
    language: 'DE',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Verhalten, Claims, Datenschutz und No-Go-Regeln.',
    sections: [
      { heading: 'Verhalten', body: ['Keine aggressiven Verkaufsmethoden.', 'Keine Manipulation von ADOREN-Antworten oder Empfehlungen.', 'Kundensituation korrekt wiedergeben.'] },
      { heading: 'No-Go Claims', body: ['Keine garantierten Umsatzsteigerungen oder Einsparungen ohne belastbare Grundlage.', 'Keine nicht freigegebenen technischen Funktionen, Rabatte oder Termine versprechen.', 'Keine Rechts-, Steuer- oder Gesundheitsaussagen außerhalb der Kompetenz.'] },
      { heading: 'Daten', body: ['Nur erforderliche Geschäftsdaten erfassen.', 'Persönliche ADOREN-Evidenz bleibt außerhalb des Partnerkontexts.'] },
    ],
  },
  {
    slug: 'adore-business',
    title: 'ADOREN Business Orientation',
    kind: 'DOCUMENT',
    category: 'ADOREN',
    language: 'DE',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Orientierung vor Investition, Tool- oder Automationsentscheidung.',
    sections: [
      { heading: 'Positionierung', body: ['Nicht alles gleichzeitig lösen. Erst verstehen, was zuerst kommt.', 'ADOREN ist bevorzugter Einstieg, aber kein Zwangstor.'] },
      { heading: 'Mögliche Ergebnisse', body: ['NO_ACTION', 'INTERNAL_ACTION', 'ADOREN Business Orientation', 'DIGITALIS Discovery', 'DIGITALIS Automation', 'URTALI Systems', 'BRIDGE', 'SELECTA', 'EXTERNAL SPECIALIST'] },
      { heading: 'Privacy Boundary', body: ['Partner erhalten ausschließlich eine freigegebene B2B-Zusammenfassung und niemals automatisch private Evidenz.'] },
    ],
  },
  {
    slug: 'digitalis-offers',
    title: 'DIGITALIS Offer Overview',
    kind: 'DOCUMENT',
    category: 'DIGITALIS',
    language: 'DE',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Discovery, Automation und CARE sauber voneinander abgrenzen.',
    sections: [
      { heading: 'Discovery', body: ['€2.500–5.000. Ein konkreter Prozessengpass ist bekannt, Ursache oder Lösung aber noch nicht ausreichend definiert.'] },
      { heading: 'Automation', body: ['€7.500–25.000+. Ein klarer, wiederkehrender Prozess mit nachvollziehbarem Nutzen soll digitalisiert, integriert oder automatisiert werden.'] },
      { heading: 'CARE', body: ['€500–2.500/Monat. Optionaler Betrieb, Monitoring, Support und Optimierung nach Übergabe.'] },
      { heading: 'Prinzip', body: ['UNDERSTAND → STRUCTURE → DIGITALIZE → AUTOMATE → AI WHERE USEFUL → HUMAN CONTROL → MEASURE → OPTIMIZE.'] },
    ],
  },
  {
    slug: 'security-privacy',
    title: 'Security & Privacy Factsheet',
    kind: 'DOCUMENT',
    category: 'TRUST & GOVERNANCE',
    language: 'DE',
    version: '0.9',
    status: 'DRAFT_REVIEW',
    summary: 'Zielarchitektur für Identität, Datenzugriff, Audit und sichere Betriebsgrenzen des Partnerportals.',
    sections: [
      { heading: 'Review-Status', body: ['Noch keine Aussage über einen produktiven Partnerportal-Betrieb: Auth0, Datenbank, AuditService und öffentliche Route sind bewusst noch nicht verbunden.', 'Die Review-Anwendung verwendet keine produktiven Kundendaten.'] },
      { heading: 'Zielkontrollen', body: ['EU-orientierte Hosting-/Identity-Architektur.', 'Rollen, Authorizations und Portfolio Permissions nach Least-Privilege-Prinzip.', 'Audit für kritische Änderungen wie Autorisierung, Lead-Konflikte, Preisfreigaben und Provisionen.', 'Trennung von Partnerdaten, Business-Kundendaten, ADOREN Personal, Finance und internen Daten.'] },
      { heading: 'Browser-Schutz', body: ['Review-Build setzt unter anderem X-Frame-Options DENY, nosniff, restriktive Permissions-Policy und no-referrer.'] },
      { heading: 'Vor Production', body: ['Security/Data Review, Tenant-Isolation, Retention/Deletion, Backup/Recovery und Incident-Prozess müssen vor Freigabe nachgewiesen werden.'] },
    ],
  },
  {
    slug: 'delivery-method',
    title: 'Project Delivery Method',
    kind: 'DOCUMENT',
    category: 'DELIVERY',
    language: 'DE',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Einheitlicher Projektpfad von Won bis Handover oder CARE.',
    sections: [
      { heading: 'Flow', body: ['WON → HANDOVER → KICKOFF → BASELINE → DESIGN → BUILD → QA → PILOT → ACCEPTANCE → HANDOVER → STABILIZE → CARE / CLOSE.'] },
      { heading: 'Gates', body: ['Kein Build ohne bestätigten Scope.', 'Kein Production Go ohne QA und definierte Acceptance Criteria.', 'Keine Scope-Erweiterung ohne Change Request.'] },
      { heading: 'Umgebungen', body: ['DEV / LOCAL → STAGING → PRODUCTION.', 'Produktive Systeme sind kein Experimentierfeld.'] },
      { heading: 'Nach Projekt', body: ['Handover an den Kunden oder separat definierter CARE-Scope.'] },
    ],
  },
  {
    slug: 'brand-usage',
    title: 'URTALI Brand Usage',
    kind: 'DOCUMENT',
    category: 'BRAND',
    language: 'DE',
    version: '0.9',
    status: 'DRAFT_REVIEW',
    summary: 'Grundregeln für URTALI, LA VOLPE und freigegebene Partnerkommunikation.',
    sections: [
      { heading: 'Markenbild', body: ['URTALI: tiefes Navy, Eisblau/Weiß und warmes Gold als Akzent.', 'Die Bergwelt vermittelt Klarheit, Höhe, Präzision und Überblick; sie ist Markenwelt, nicht zwingend Bestandteil jeder Logovariante.'] },
      { heading: 'Partnernutzung', body: ['Nur freigegebene Logos, Cases, Vorlagen und aktuelle Dokumentversionen verwenden.', 'Keine eigenen Leistungsversprechen, Logos oder Referenzclaims aus freigegebenem Material ableiten.'] },
      { heading: 'Referenzen', body: ['CONCEPT, DEMO, PILOT und VERIFIED CUSTOMER CASE müssen klar voneinander unterschieden werden.', 'Kundenname oder Logo nur bei explizit freigegebener Nutzung.'] },
    ],
  }
];

export const salesAssets: readonly PortalContent[] = [
  {
    slug: 'outreach-it',
    title: 'Akquise Erstkontakt · Italien',
    kind: 'SALES_ASSET',
    category: 'EMAIL_TEMPLATE',
    language: 'IT',
    version: '2.1',
    status: 'APPROVED_REVIEW',
    summary: 'Kurzer Erstkontakt mit ADOREN als neutralem Einstieg.',
    sections: [
      { heading: 'E-Mail', body: ['Buongiorno Sig./Sig.ra [Nome],', 'lavoro con LA VOLPE nell’analisi di processi, organizzazione e digitalizzazione delle imprese.', 'Abbiamo creato ADOREN, un breve orientamento gratuito che aiuta a capire dove oggi può esserci il margine di miglioramento più interessante.', 'Non parte da un prodotto da vendere: prima cerca di capire la situazione.', 'Se vuole, le mando il link.', 'Cordiali saluti, Alessandro De Rosa'] },
      { heading: 'CTA', body: ['Soll ich Ihnen den Link schicken? Kein Terminzwang im Erstkontakt.'] },
    ],
  },
  {
    slug: 'phone-it',
    title: 'Telefonleitfaden · Italien',
    kind: 'SALES_ASSET',
    category: 'PHONE_SCRIPT',
    language: 'IT',
    version: '1.4',
    status: 'APPROVED_REVIEW',
    summary: 'Einfaches Italienisch für den ersten B2B-Telefonkontakt.',
    sections: [
      { heading: 'Einstieg', body: ['Buongiorno, sono Alessandro De Rosa di LA VOLPE.', 'La chiamo molto brevemente.', 'Aiutiamo le imprese a capire dove processi, organizzazione o strumenti possono funzionare meglio.', 'Posso mandarle il link via e-mail o WhatsApp?'] },
      { heading: 'Rettungssatz', body: ['Preferisco essere preciso piuttosto che spiegare male una cosa complessa in italiano. Se vuole, le mando una spiegazione molto chiara per iscritto.'] },
    ],
  },
  {
    slug: 'discovery-guide',
    title: 'Discovery Guide',
    kind: 'SALES_ASSET',
    category: 'DISCOVERY_GUIDE',
    language: 'DE / IT',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Situation, Ursache, Wirkung, Readiness und Routing strukturiert prüfen.',
    sections: [
      { heading: 'Kernfragen', body: ['Mi descrive brevemente come funziona oggi?', 'Dove si perde più tempo?', 'Chi se ne occupa?', 'E dopo cosa succede?', 'Può farmi un esempio concreto?', 'Se cambiassimo solo lo strumento, il problema sarebbe davvero risolto?'] },
      { heading: 'Qualification', body: ['Need', 'Impact', 'Clarity', 'Readiness', 'Decision Access', 'Fit'] },
      { heading: 'Abschluss', body: ['Der nächste Schritt wird aus dem Problem abgeleitet, nicht aus dem umsatzstärksten Angebot.'] },
    ],
  },
  {
    slug: 'objection-handling',
    title: 'Einwandbehandlung · Preis & KI',
    kind: 'SALES_ASSET',
    category: 'OBJECTION_HANDLING',
    language: 'IT',
    version: '1.1',
    status: 'APPROVED_REVIEW',
    summary: 'Kurze Antworten auf typische Fragen ohne technischen Overload.',
    sections: [
      { heading: 'Cosa vendete?', body: ['Dipende dal problema. A volte basta migliorare un processo. A volte servono strumenti digitali, automazioni o un sistema più specifico. Per questo preferiamo capire prima la situazione.'] },
      { heading: 'Usate l’IA?', body: ['Sì, utilizziamo anche l’intelligenza artificiale quando ha senso. Ma non partiamo dall’IA. Prima capiamo il processo e il risultato da ottenere.'] },
      { heading: 'Quanto costa?', body: ['Dipende dal problema e dalla profondità dell’intervento. Prima definiamo cosa serve realmente; solo dopo prepariamo una proposta chiara.'] },
    ],
  },
  {
    slug: 'automotive-case',
    title: 'Solution Case · Automotive Lead Flow',
    kind: 'SALES_ASSET',
    category: 'CASE',
    language: 'DE / IT',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Website, Portale, E-Mail und WhatsApp in einen kontrollierten Leadprozess überführen.',
    sections: [
      { heading: 'Ausgangslage', body: ['Mehrere Leadquellen, mehrere Verkäufer, unklare Zuständigkeit, kein einheitlicher Follow-up-Status.'] },
      { heading: 'Zielprozess', body: ['Capture → Normalize → Assign → CRM → Follow-up → Reminder → Human Handoff → Reporting.'] },
      { heading: 'Beweis', body: ['Demonstrator ausschließlich mit synthetischen Leads; keine erfundenen Kundenergebnisse.'] },
    ],
  },
  {
    slug: 'hotel-case',
    title: 'Solution Case · Hospitality Operations',
    kind: 'SALES_ASSET',
    category: 'CASE',
    language: 'DE / IT',
    version: '1.0',
    status: 'APPROVED_REVIEW',
    summary: 'Wiederkehrende Kommunikations- und Übergabeprozesse im Hotelbetrieb reduzieren.',
    sections: [
      { heading: 'Ausgangslage', body: ['Website, OTA, Telefon, E-Mail und WhatsApp erzeugen wiederkehrende Gästefragen und manuelle Übergaben.'] },
      { heading: 'Prinzip', body: ['Nicht die Rezeption ersetzen, sondern wiederkehrende Arbeit reduzieren und Human Control erhalten.'] },
      { heading: 'Beispiel', body: ['Late Arrival Anfrage → klassifizieren → Kontext prüfen → vorbereitete Antwort / Freigabe → Aufgabe Rezeption → dokumentierter Status.'] },
    ],
  },
];

export function findPortalContent(kind: PortalContent['kind'], slug: string): PortalContent | undefined {
  const source = kind === 'DOCUMENT' ? knowledgeDocuments : salesAssets;
  return source.find((entry) => entry.slug === slug);
}
