/**
 * NON-EXECUTABLE source-only DOROTHEA proposal validation.
 * This is NOT FSN1's AgentSpec validator. Registration/activation never occurs.
 */
import {readFileSync} from 'node:fs';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=code=>{throw Error('DOROTHEA_DRAFT_'+code)};
export function validateDorotheaProposal(profile,mission){
 if(!profile||profile.proposalVersion!=='dorothea.vito-specialist-proposal/0.1.0'||
  profile.kind!=='NON_EXECUTABLE_PROFILE_PROPOSAL_NOT_AGENT_SPEC'||
  profile.state!=='SOURCE_ONLY_NOT_REGISTERED')fail('PROPOSAL_CONTRACT_INVALID');
 const p=profile.record;
 if(!p||Object.keys(p).sort().join()!=='code,description,employeeType,name,status,version'||
  p.name!=='DOROTHEA'||p.code!=='dorothea'||p.employeeType!=='SPECIALIST'||
  p.status!=='DRAFT'||p.version!=='0.1.0'||
  typeof p.description!=='string'||p.description.length>1000)fail('EMPLOYEE_DTO_INVALID');
 if(!profile.dataRules||
  profile.dataRules.tenantContext!=='VITO_VERIFIED_JWT_AND_SERVER_MEMBERSHIP_NOT_USER_SUPPLIED'||
  profile.dataRules.persistedUserData!=='DENIED'||
  profile.dataRules.rawUserAnswers!=='DENIED'||
  profile.dataRules.healthSensitiveData!=='DENIED'||
  profile.dataRules.realTenantData!=='DENIED'||
  profile.dataRules.ownerApproval!=='REQUIRED_FOR_EVERY_NEW_GRANT_OR_EXTERNAL_ACTION')
  fail('DATA_BOUNDARY_INVALID');
 const caps=profile.capabilitiesProposed;
 if(!Array.isArray(caps)||caps.length!==8)fail('CAPABILITIES_INVALID');
 const codes=new Set();
 for(const c of caps){
  if(!c||typeof c.code!=='string'||!/^adoren\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(c.code)||
   codes.has(c.code)||c.isEnabled!==false||c.requiresApproval!==true||
   !['LOW','MEDIUM','HIGH','CRITICAL'].includes(c.riskLevel)||
   typeof c.scope!=='string'||c.scope.length<4)fail('CAPABILITY_GUARD_INVALID');
  codes.add(c.code);
 }
 for(const code of ['adoren.source.inspect','adoren.eval.read','adoren.quality.assess',
  'adoren.hypothesis.propose','adoren.experiment.propose','adoren.research.request',
  'adoren.engineering.draft.request','adoren.quality.report'])
  if(!codes.has(code))fail('MISSING_CAPABILITY');
 if(!Array.isArray(profile.forbidden)||![
  'git.push','git.merge','deploy.production','shell.execute','secrets.read',
  'db.migrate','provider.activate','provider.bill','permissions.grant',
  'employee.activate','user.data.read','user.data.export','model.train',
  'scheduler.enable','self.update'
 ].every(x=>profile.forbidden.includes(x)))fail('FORBIDDEN_CAPABILITY_MISSING');
 if(profile.engineeringBoundary!=='AGENT_BUILDER_SPEC_NOT_YET_VERIFIED_AGAINST_DIRTY_LOCAL_FSN1_SOURCE'||
  profile.releaseGate!=='NO_GO'||profile.merge!=='NO_GO'||profile.deploy!=='NO_GO')
  fail('RELEASE_GATES_INVALID');
 if(!mission||mission.missionId!=='DOROTHEA_ADOREN_QUALITY_BASELINE_V1'||
  mission.status!=='PROPOSED_NOT_DISPATCHED'||mission.ownerReview!=='REQUIRED'||
  mission.ownerRepo!=='lavolpeofficial/aoe-app'||
  mission.baseSource?.exactCommit!=='2abfddcea81637923a4ec5309dc1410fbeedf9c3'||
  mission.baseSource?.scope!=='UNMERGED_SOURCE_ONLY')
  fail('MISSION_SCOPE_INVALID');
 const l=mission.limits;
 if(!l||!['network','providerCalls','realUserData','dbAccess','codeExecution',
  'writeRepo','writeAudit'].every(x=>own(l,x)&&l[x]===false)||
  l.timeBudgetMinutes!==0||l.costCapEur!==0||l.schedule!=='NONE'||
  l.ownerApprovalRef!==null)fail('MISSION_EXECUTION_LOCK_INVALID');
 if(!Array.isArray(mission.deliverables)||mission.deliverables.length<3||
  !Array.isArray(mission.proposedCollaborators)||
  mission.proposedCollaborators.sort().join()!=='BOB,RICCARDO,VITO'||
  mission.merge!=='NO_GO'||mission.deploy!=='NO_GO')
  fail('MISSION_OUTPUT_OR_GATES_INVALID');
 return Object.freeze({status:'PASS_PROPOSAL_ONLY',employee:p.code,
  capCount:caps.length,capabilitiesEnabled:0,missionId:mission.missionId,
  realAgentSpec:'NOT_VERIFIED',agentRegistered:false,
  sourceWorktree:'NOT_TOUCHED',db:'NOT_ACCESSED',live:'NO_GO',deploy:'NO_GO'});
}
const load=(f)=>JSON.parse(readFileSync(new URL(f,import.meta.url),'utf8'));
if(process.argv[1]?.endsWith('validate-proposal.mjs')){
 const result=validateDorotheaProposal(load('./profile.proposal.json'),load('./mission.proposal.json'));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}