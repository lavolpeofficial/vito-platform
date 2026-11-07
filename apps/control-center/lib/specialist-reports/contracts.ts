export type SpecialistReport = Readonly<{
  reportId: string;
  specialist: 'adoren'|'emporio'|'urtali'|'bridge'|'selecta'|'lavolpe'|'bob'|'riccardo';
  subject: string;
  reportedStatus: string | null;
  reportedAt: string;
  authenticatedAgentReport: false;
  executionVerified: false;
  ownerReleaseApproved: false;
}>;
export type SpecialistReportsOverview = Readonly<{
  organizationId: string;
  authority: 'READ_ONLY';
  sourceHealth: 'HEALTHY'|'STALE';
  observedAt: string;
  reports: readonly SpecialistReport[];
}>;
const ALLOWED = new Set(['adoren','emporio','urtali','bridge','selecta','lavolpe','bob','riccardo']);
const iso=(v:unknown):v is string=>typeof v==='string'&&v.length>=20&&v.length<=40&&!Number.isNaN(Date.parse(v));
function obj(v:unknown):Record<string,unknown>|null {
  return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
}
export function parseSpecialistReportsOverview(input:unknown):SpecialistReportsOverview|null {
  const value=obj(input);
  if(!value||typeof value.organizationId!=='string'||value.organizationId.length<1||
    value.organizationId.length>128||value.authority!=='READ_ONLY'||
    !['HEALTHY','STALE'].includes(String(value.sourceHealth))||
    !iso(value.observedAt)||!Array.isArray(value.reports)||value.reports.length>50)return null;
  const seen=new Set<string>();const reports:SpecialistReport[]=[];
  for(const entry of value.reports){
    const row=obj(entry);
    if(!row||typeof row.reportId!=='string'||!/^[1-9][0-9]{0,18}$/.test(row.reportId)||
      seen.has(row.reportId)||!ALLOWED.has(String(row.specialist))||
      typeof row.subject!=='string'||!row.subject.length||row.subject.length>160||
      !iso(row.reportedAt)||
      (row.reportedStatus!==null&&
         (typeof row.reportedStatus!=='string'||!/^[A-Z0-9_:-]{1,80}$/.test(row.reportedStatus)))||
      row.authenticatedAgentReport!==false||row.executionVerified!==false||
      row.ownerReleaseApproved!==false)return null;
    seen.add(row.reportId);
    reports.push({
      reportId:row.reportId,specialist:row.specialist as SpecialistReport['specialist'],
      subject:row.subject,reportedStatus:row.reportedStatus as string|null,
      reportedAt:row.reportedAt,authenticatedAgentReport:false,
      executionVerified:false,ownerReleaseApproved:false,
    });
  }
  return{
    organizationId:value.organizationId,authority:'READ_ONLY',
    sourceHealth:value.sourceHealth as 'HEALTHY'|'STALE',
    observedAt:value.observedAt,reports,
  };
}
