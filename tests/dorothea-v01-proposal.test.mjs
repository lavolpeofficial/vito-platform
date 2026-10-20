import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDorotheaProposal} from '../proposals/digital-employees/dorothea-v0.1/validate-proposal.mjs';
const dir=new URL('../proposals/digital-employees/dorothea-v0.1/',import.meta.url);
const get=(f)=>JSON.parse(readFileSync(new URL(f,dir),'utf8'));
const copy=x=>JSON.parse(JSON.stringify(x));
const load=()=>[get('profile.proposal.json'),get('mission.proposal.json')];
const valid=(fn)=>{const [p,m]=load();fn(p,m);return [p,m]};
test('source-only profile validates under PROPOSAL contract',()=>{
 const [p,m]=load(),r=validateDorotheaProposal(p,m);
 assert.equal(r.status,'PASS_PROPOSAL_ONLY');
 assert.equal(r.realAgentSpec,'NOT_VERIFIED');
 assert.equal(r.agentRegistered,false);
});
test('eight prospective capabilities must all remain disabled',()=>{
 const [p,m]=load(),r=validateDorotheaProposal(p,m);
 assert.equal(r.capCount,8);assert.equal(r.capabilitiesEnabled,0);
 assert.equal(p.capabilitiesProposed.every(x=>x.isEnabled===false),true);
});
test('employee type SPECIALIST and status DRAFT cannot change',()=>{
 const [p,m]=valid(p=>{p.record.employeeType='ORCHESTRATOR'});
 assert.throws(()=>validateDorotheaProposal(p,m),/EMPLOYEE_DTO_INVALID/);
});
test('agent cannot be marked active by changing JSON',()=>{
 const [p,m]=valid(p=>{p.record.status='ACTIVE'});
 assert.throws(()=>validateDorotheaProposal(p,m),/EMPLOYEE_DTO_INVALID/);
});
test('agent code cannot impersonate VITO',()=>{
 const [p,m]=valid(p=>{p.record.code='vito'});
 assert.throws(()=>validateDorotheaProposal(p,m),/EMPLOYEE_DTO_INVALID/);
});
test('data scope rejects permission to read real user answers',()=>{
 const [p,m]=valid(p=>{p.dataRules.rawUserAnswers='ALLOWED'});
 assert.throws(()=>validateDorotheaProposal(p,m),/DATA_BOUNDARY_INVALID/);
});
test('tenant authority cannot be made client-supplied',()=>{
 const [p,m]=valid(p=>{p.dataRules.tenantContext='CLIENT_HEADER'});
 assert.throws(()=>validateDorotheaProposal(p,m),/DATA_BOUNDARY_INVALID/);
});
test('capability cannot be enabled in source-only draft',()=>{
 const [p,m]=valid(p=>{p.capabilitiesProposed[0].isEnabled=true});
 assert.throws(()=>validateDorotheaProposal(p,m),/CAPABILITY_GUARD_INVALID/);
});
test('capability grant approval cannot be disabled',()=>{
 const [p,m]=valid(p=>{p.capabilitiesProposed[5].requiresApproval=false});
 assert.throws(()=>validateDorotheaProposal(p,m),/CAPABILITY_GUARD_INVALID/);
});
test('capability codes must match VITO dot syntax',()=>{
 const [p,m]=valid(p=>{p.capabilitiesProposed[0].code='shell execute'});
 assert.throws(()=>validateDorotheaProposal(p,m),/CAPABILITY_GUARD_INVALID/);
});
test('duplicate proposed capabilities blocked',()=>{
 const [p,m]=valid(p=>{p.capabilitiesProposed[1].code=p.capabilitiesProposed[0].code});
 assert.throws(()=>validateDorotheaProposal(p,m),/CAPABILITY_GUARD_INVALID/);
});
test('forbidden grants must remain explicit',()=>{
 const [p,m]=valid(p=>{p.forbidden=p.forbidden.filter(x=>x!=='git.merge')});
 assert.throws(()=>validateDorotheaProposal(p,m),/FORBIDDEN_CAPABILITY_MISSING/);
});
test('agent-builder compat caveat cannot be removed',()=>{
 const [p,m]=valid(p=>{p.engineeringBoundary='READY_FOR_PRODUCTION'});
 assert.throws(()=>validateDorotheaProposal(p,m),/RELEASE_GATES_INVALID/);
});
test('mission pins source-only AOE 1E SHA',()=>{
 const [p,m]=valid((p,m)=>{m.baseSource.exactCommit='0'.repeat(40)});
 assert.throws(()=>validateDorotheaProposal(p,m),/MISSION_SCOPE_INVALID/);
});
test('mission cannot quietly call providers',()=>{
 const [p,m]=valid((p,m)=>{m.limits.providerCalls=true});
 assert.throws(()=>validateDorotheaProposal(p,m),/MISSION_EXECUTION_LOCK_INVALID/);
});
test('mission cannot silently execute code',()=>{
 const [p,m]=valid((p,m)=>{m.limits.codeExecution=true});
 assert.throws(()=>validateDorotheaProposal(p,m),/MISSION_EXECUTION_LOCK_INVALID/);
});
test('mission cannot implicitly spend budget',()=>{
 const [p,m]=valid((p,m)=>{m.limits.costCapEur=5});
 assert.throws(()=>validateDorotheaProposal(p,m),/MISSION_EXECUTION_LOCK_INVALID/);
});
test('mission cannot acquire a recurring schedule',()=>{
 const [p,m]=valid((p,m)=>{m.limits.schedule='DAILY'});
 assert.throws(()=>validateDorotheaProposal(p,m),/MISSION_EXECUTION_LOCK_INVALID/);
});
test('mission must remain undisbursed',()=>{
 const [p,m]=valid((p,m)=>{m.status='RUNNING'});
 assert.throws(()=>validateDorotheaProposal(p,m),/MISSION_SCOPE_INVALID/);
});
test('proposal remains unmerged and undeployed',()=>{
 const [p,m]=valid((p,m)=>{p.deploy='GO'});
 assert.throws(()=>validateDorotheaProposal(p,m),/RELEASE_GATES_INVALID/);
});
test('validator must not mutate proposal inputs',()=>{
 const [p,m]=load(),a=copy(p),b=copy(m);
 validateDorotheaProposal(p,m);assert.deepEqual(p,a);assert.deepEqual(m,b);
});
