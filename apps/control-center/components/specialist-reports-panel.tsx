import type { SpecialistReportsOverview } from '@/lib/specialist-reports/contracts';

type Props=Readonly<{permitted:boolean; snapshot:SpecialistReportsOverview|null}>;
const PORTALS=[
  {id:'lavolpe',name:'LA VOLPE'},
  {id:'emporio',name:'EMPORIO OLISTICO'},
  {id:'urtali',name:'URTALI SYSTEMS'},
  {id:'adoren',name:'ADOREN'},
  {id:'selecta',name:'SELECTA'},
  {id:'bridge',name:'BRIDGE'},
] as const;
function localizedTime(value:string):string {
  return new Intl.DateTimeFormat('de-DE',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Rome'}).format(new Date(value));
}
/** Verified source health, NOT verified specialist identity or task completion. */
export function SpecialistReportsPanel({permitted,snapshot}:Props){
  return (
    <section aria-labelledby="specialist-reports-title" className="boundary-notice">
      <span className="system-dot"/>
      <div style={{minWidth:0,width:'100%'}}>
        <strong id="specialist-reports-title">Fachbereiche · Letzte Rückmeldungen</strong>
        {!permitted?(
          <p>Diese unternehmensweite Übersicht ist ausschließlich für OWNER freigegeben.</p>
        ):!snapshot?(
          <p>Quelle derzeit nicht sicher verfügbar oder zu alt. Fachbereichsstatus unbekannt.</p>
        ):(
          <>
            <p>Stand {localizedTime(snapshot.observedAt)} (Italien). Selbst gemeldete CONTROL-BUS-Texte – <strong>nicht signiert und kein Ausführungsnachweis</strong>.</p>
            <div role="list" aria-label="Letzte selbst gemeldete Portalstatus">
              {PORTALS.map(portal=>{
                const latest=snapshot.reports.find(r=>r.specialist===portal.id);
                return <div role="listitem" key={portal.id} style={{borderTop:'1px solid var(--line)',padding:'10px 0'}}>
                  <strong>{portal.name}</strong>
                  {!latest?(
                    <p>Keine Fachbereichsmeldung im begrenzten Abfragefenster – tatsächlicher Status unbekannt.</p>
                  ):(
                    <>
                      <p><span style={{fontVariantNumeric:'tabular-nums'}}>#{latest.reportId}</span> · {latest.reportedStatus??'Kein technischer Statuscode'} · {localizedTime(latest.reportedAt)}</p>
                      <p>{latest.subject}</p>
                      <small>Absenderangabe aus CONTROL BUS, nicht kryptografisch verifiziert.</small>
                    </>
                  )}
                </div>;
              })}
            </div>
            <p>Zusätzliche Berichte außerhalb dieses Ausschnitts können existieren. Automatisierte Fertigmeldungen und Owner-Freigaben werden hier ausdrücklich nicht abgeleitet.</p>
          </>
        )}
      </div>
    </section>
  );
}
