import './workforce.css';
import { buildApiPath } from '@/lib/api/client';
import { VitoApiError } from '@/lib/api/error';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { parseCapabilities, parseCapabilityDiscovery, parseEmployees, parseProviderSnapshot, type CapabilityDiscovery, type ProviderSnapshot, type WorkforceCapability, type WorkforceEmployee } from '@/lib/workforce/contracts';

export const metadata = { title: 'Agents & Capabilities' };
type SearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

export default async function WorkforcePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
  const capabilityQuery = first(params.capability)?.trim().toUpperCase().slice(0, 128) ?? '';
  let employees: readonly WorkforceEmployee[] = [];
  let capabilities: readonly WorkforceCapability[] = [];
  let providers: ProviderSnapshot | null = null;
  let discovery: CapabilityDiscovery | null = null;
  let loadError: string | null = null;

  try {
    const client = await createAuthenticatedVitoApiClient();
    [employees, capabilities, providers] = await Promise.all([
      client.get('/digital-employees', parseEmployees),
      client.get('/capabilities', parseCapabilities),
      client.get('/provider-intelligence', parseProviderSnapshot),
    ]);
    if (capabilityQuery) discovery = await client.get(buildApiPath(`/capability-discovery/${encodeURIComponent(capabilityQuery)}` as `/${string}`, {}), parseCapabilityDiscovery);
  } catch (error) {
    loadError = error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR';
  }

  const active = employees.filter((employee) => employee.status === 'ACTIVE').length;
  const enabledAssignments = employees.reduce((sum, employee) => sum + employee.capabilities.filter((entry) => entry.isEnabled).length, 0);
  const routable = providers?.capabilityCoverage.filter((row) => row.staticallyRoutableProviderCount > 0).length ?? 0;

  return <main>
    <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Agents & Capabilities</span></div>
    <section className="module-heading"><div className="module-icon">AC</div><div><span className="eyebrow">Digital workforce</span><h1>Agents & Capabilities</h1><p>Digital Employees, Capability-Zuweisungen und Provider-Readiness in einer tenant-gebundenen Sicht.</p></div></section>
    <div className="boundary-notice"><span className="system-dot" /><div><strong>Governed runtime</strong><p>Diese Oberfläche aktiviert weder Capabilities noch Provider automatisch. Capability Discovery bleibt diagnostisch; Ausführbarkeit entsteht nur durch bestehende VITO-Governance.</p></div></div>
    {loadError ? <div className="workforce-banner">Workforce konnte nicht vollständig geladen werden: {loadError}</div> : null}

    <section className="wf-metrics">
      <Metric label="Digital Employees" value={employees.length} note={`${active} ACTIVE`} />
      <Metric label="Capabilities" value={capabilities.length} note={`${enabledAssignments} enabled assignments`} />
      <Metric label="Provider baseline" value={providers?.providers.length ?? 0} note={`${routable} routable capabilities`} />
    </section>

    <section className="wf-grid">
      <div className="wf-panel"><div className="wf-head"><div><span className="eyebrow">01 · Workforce</span><h2>Digital Employees</h2></div><span className="status-chip">{employees.length} agents</span></div>
        {employees.length === 0 ? <p className="wf-empty">Keine Digital Employees registriert.</p> : <div className="wf-list">{employees.map((employee) => <EmployeeCard key={employee.id} employee={employee} />)}</div>}
      </div>
      <div className="wf-panel"><span className="eyebrow">02 · Discovery</span><h2>Capability prüfen</h2><p className="wf-muted">VITO bewertet Registrierung, Agent-Zuweisung, Provider-Bindings und governte Skill Candidates.</p>
        <form className="wf-search" method="get"><input name="capability" defaultValue={capabilityQuery} maxLength={128} placeholder="z. B. CODE_BUILD" /><button type="submit">Prüfen</button></form>
        {capabilityQuery ? (discovery ? <DiscoveryCard result={discovery} /> : <p className="wf-empty">Keine Discovery-Antwort verfügbar.</p>) : <p className="wf-empty">Capability-Code eingeben.</p>}
      </div>
    </section>

    <section className="wf-panel wf-wide"><div className="wf-head"><div><span className="eyebrow">03 · Capability Registry</span><h2>Capabilities</h2></div><span className="status-chip">{capabilities.length} registered</span></div>
      <div className="capability-table"><div className="cap-row cap-header"><span>Code</span><span>Name</span><span>Risk</span><span>Approval</span><span>Provider readiness</span></div>{capabilities.map((capability) => <CapabilityRow key={capability.id} capability={capability} coverage={providers?.capabilityCoverage.find((row) => row.capabilityCode === capability.code)} />)}</div>
    </section>

    <section className="wf-panel wf-wide"><div className="wf-head"><div><span className="eyebrow">04 · Providers</span><h2>Provider Readiness</h2></div><span className="status-chip">READ ONLY</span></div>
      {providers?.providers.length ? <div className="provider-grid">{providers.providers.map((provider) => <article className="provider-card" key={provider.id}><div><strong>{provider.displayName}</strong><span>{provider.providerCode}</span></div><div className="provider-state"><Status value={provider.status}/><Status value={provider.healthStatus}/><Status value={provider.quotaStatus}/></div><p>{provider.staticallyRoutable ? 'Statically routable' : 'Not currently routable'}</p><small>{provider.enabledCapabilities.length} enabled capabilities</small></article>)}</div> : <p className="wf-empty">Keine Provider registriert.</p>}
    </section>
  </main>;
}

function Metric({label,value,note}:Readonly<{label:string;value:number;note:string}>){return <article className="wf-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>}
function EmployeeCard({employee}:Readonly<{employee:WorkforceEmployee}>){return <article className="employee-card"><div className="employee-top"><div><strong>{employee.name}</strong><span>{employee.code} · {employee.employeeType} · v{employee.version}</span></div><Status value={employee.status}/></div><div className="employee-caps">{employee.capabilities.length===0?<small>No capabilities assigned</small>:employee.capabilities.map((entry)=><span key={entry.capability.id} className={entry.isEnabled?'cap-enabled':'cap-disabled'}>{entry.capability.code}{entry.capability.requiresApproval?' · approval':''}</span>)}</div><small>{employee.workforceInstanceId ? `Workforce ${employee.workforceInstanceId}` : 'No workforce assignment'}</small></article>}
function DiscoveryCard({result}:Readonly<{result:CapabilityDiscovery}>){return <article className="discovery-card"><div className="discovery-main"><strong>{result.code}</strong><Status value={result.availability}/></div><dl><div><dt>Official engineering</dt><dd>{result.officialEngineeringCapability?'yes':'no'}</dd></div><div><dt>Assigned agents</dt><dd>{result.assignedDigitalEmployeeCount}</dd></div><div><dt>Executable providers</dt><dd>{result.executableProviders.length}</dd></div></dl>{result.registeredCapability?<p>Registered: {result.registeredCapability.name} · {result.registeredCapability.riskLevel}</p>:null}{result.gap?<div className="gap-box"><strong>{result.gap.type}</strong><span>{result.gap.suggestedNextState}</span></div>:<div className="gap-box gap-ok"><strong>No capability gap</strong></div>}</article>}
function CapabilityRow({capability,coverage}:Readonly<{capability:WorkforceCapability;coverage:ProviderSnapshot['capabilityCoverage'][number]|undefined}>){return <div className="cap-row"><strong>{capability.code}</strong><span>{capability.name}</span><span>{capability.riskLevel}</span><span>{capability.requiresApproval?'required':'no'}</span><span>{coverage?.readiness ?? 'NO_PROVIDER_DATA'}{coverage?` · ${coverage.staticallyRoutableProviderCount}/${coverage.enabledProviderCount}`:''}</span></div>}
function Status({value}:Readonly<{value:string}>){return <span className={`wf-status wf-status-${value.toLowerCase().replaceAll('_','-')}`}>{value}</span>}
function first(value:string|string[]|undefined):string|undefined{return Array.isArray(value)?value[0]:value}
