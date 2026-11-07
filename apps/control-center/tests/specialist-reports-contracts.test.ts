import assert from 'node:assert/strict';
import test from 'node:test';
import {parseSpecialistReportsOverview} from '../lib/specialist-reports/contracts.ts';

const one={
 reportId:'91',specialist:'urtali',subject:'R65 public release reported',
 reportedStatus:'PUBLIC_RELEASE_PASS',reportedAt:'2026-11-07T13:07:20.812Z',
 authenticatedAgentReport:false,executionVerified:false,ownerReleaseApproved:false,
};
const example={
 organizationId:'12f04021-a04c-4498-a7f2-5c28906d7d21',
 authority:'READ_ONLY',sourceHealth:'HEALTHY',observedAt:'2026-11-07T13:10:00.000Z',reports:[one],
};
test('accepts one safe unverified status report',()=>{
 const v=parseSpecialistReportsOverview(example);
 assert.ok(v);assert.equal(v.reports[0].reportId,'91');
 assert.equal(v.reports[0].authenticatedAgentReport,false);
 assert.equal(v.reports[0].executionVerified,false);
 assert.equal(v.reports[0].ownerReleaseApproved,false);
});
test('rejects fake receipt truth, unsafe status, wrong tenant shape',()=>{
 assert.equal(parseSpecialistReportsOverview({...example,reports:[{...one,executionVerified:true}]}),null);
 assert.equal(parseSpecialistReportsOverview({...example,reports:[{...one,reportedStatus:'<b>LIVE</b>'}]}),null);
 assert.equal(parseSpecialistReportsOverview({...example,organizationId:null}),null);
 assert.equal(parseSpecialistReportsOverview({...example,authority:'WRITE'}),null);
});
test('rejects duplicate IDs, unbounded rows and invalid source timestamps',()=>{
 assert.equal(parseSpecialistReportsOverview({...example,reports:[one,one]}),null);
 assert.equal(parseSpecialistReportsOverview({...example,reports:Array(51).fill(one)}),null);
 assert.equal(parseSpecialistReportsOverview({...example,observedAt:'yesterday'}),null);
});
test('a verified-empty reporting window is different from unknown source health',()=>{
 const v=parseSpecialistReportsOverview({...example,reports:[]});
 assert.ok(v);assert.deepEqual(v.reports,[]);
 assert.equal(parseSpecialistReportsOverview(null),null);
});
