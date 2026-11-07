import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { normalizeOwnerSpecialistReports } from './owner-specialist-reports.contract';
import { ExecutiveReceiptsService } from './executive-receipts.service';

const ORG = '12f04021-a04c-4498-a7f2-5c28906d7d21';
const item = {
  report_id: 91n,
  specialist: 'urtali',
  subject: 'R65 reported live',
  reported_status: 'PUBLIC_RELEASE_PASS',
  reported_at: new Date('2026-11-07T13:07:20.812Z'),
};

describe('bounded unsigned specialist reports', () => {
  it('accepts a status report without promoting it to proof', () => {
    const report=normalizeOwnerSpecialistReports([item])[0];
    expect(report.reportId).toBe('91');
    expect(report.reportedStatus).toBe('PUBLIC_RELEASE_PASS');
    expect(report.authenticatedAgentReport).toBe(false);
    expect(report.executionVerified).toBe(false);
    expect(report.ownerReleaseApproved).toBe(false);
  });
  it('rejects forged status, forged sender, duplicate reports and oversized lists', () => {
    for (const invalid of [
      {...item, specialist:'unknown-tenant'},
      {...item,reported_status:'LIVE <script>alert(1)</script>'},
      {...item,subject:''},
      {...item,report_id:'0'},
      {...item,reported_at:'invalid'},
    ]) expect(()=>normalizeOwnerSpecialistReports([invalid])).toThrow();
    expect(()=>normalizeOwnerSpecialistReports([item,item])).toThrow();
    expect(()=>normalizeOwnerSpecialistReports(Array.from({length:51},(_,i)=>({...item,report_id:BigInt(i+1)})))).toThrow();
  });
  it('allows truthful missing status and empty report list', () => {
    expect(normalizeOwnerSpecialistReports([])).toEqual([]);
    expect(normalizeOwnerSpecialistReports([{...item,reported_status:null}])[0].reportedStatus).toBeNull();
  });
});

describe('reports endpoint guard', () => {
  const old={...process.env};
  const tenant=(id=ORG,role='OWNER',method='jwt')=>({
    getOrThrow:()=>id,getUserId:()=> 'owner-auth-subject',getRole:()=>role,getAuthenticationMethod:()=>method,
  }) as TenantContext;
  afterEach(()=>{
    for(const key of ['VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID','VITO_CONTROL_BUS_READER_ENABLED','VITO_CONTROL_BUS_READONLY_DATABASE_URL']){
      if(old[key]===undefined) delete process.env[key];else process.env[key]=old[key];
    }
  });
  it('denies non-Owner and cross-tenant before any DB access', async()=>{
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID=ORG;
    process.env.VITO_CONTROL_BUS_READER_ENABLED='true';
    const svc=new ExecutiveReceiptsService();
    await expect(svc.reportsOverview(tenant(ORG,'ADMIN'))).rejects.toThrow(ForbiddenException);
    await expect(svc.reportsOverview(tenant('00000000-0000-4000-8000-000000000999'))).rejects.toThrow(ForbiddenException);
    await expect(svc.reportsOverview(tenant(ORG,'OWNER','insecure-header'))).rejects.toThrow(ForbiddenException);
  });
  it('disabled/missing scoped reader fails closed',async()=>{
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID=ORG;
    process.env.VITO_CONTROL_BUS_READER_ENABLED='false';
    const svc=new ExecutiveReceiptsService();
    await expect(svc.reportsOverview(tenant())).rejects.toThrow(ServiceUnavailableException);
    process.env.VITO_CONTROL_BUS_READER_ENABLED='true';
    delete process.env.VITO_CONTROL_BUS_READONLY_DATABASE_URL;
    await expect(svc.reportsOverview(tenant())).rejects.toThrow(ServiceUnavailableException);
  });
});
