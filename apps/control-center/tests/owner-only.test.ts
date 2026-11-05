import assert from 'node:assert/strict';
import test from 'node:test';
import { isVitoControlOwnerOnlyEnabled, isVitoInteractiveOwner } from '../lib/auth/owner-access.ts';
import { resolveVitoOwnerSession, resolveVitoSession } from '../lib/auth/owner-session.ts';
import type { AuthenticatedSession } from '../lib/auth/contracts.ts';
import type { VitoApiClient } from '../lib/api/client.ts';

const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const organizationId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherUser='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherOrg='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const policy={ownerUserId:userId,ownerOrganizationId:organizationId};
const session:AuthenticatedSession={
 user:{id:userId,organizationId,role:'OWNER',email:'test@example.invalid',firstName:'Test',lastName:'Owner'},
 organization:{id:organizationId,name:'LA VOLPE',slug:'la-volpe'}
};
const activeOrg={...session.organization,status:'ACTIVE'};
const token=()=> 'eyJhbGciOiJIUzI1NiJ9.'+
 Buffer.from(JSON.stringify({sub:userId,org_id:organizationId})).toString('base64url')+
 '.YWJjZGVm';
function fakeApi(user:unknown=session.user,org:unknown=activeOrg){
 return {async get<T>(path:string,parser:(input:unknown)=>T|null):Promise<T>{
  const value=path.startsWith('/users/')?user:org;
  const result=parser(value);
  if(result===null)throw new Error('REJECTED_BY_API_PARSER');
  return result;
 }} as Pick<VitoApiClient,'get'>;
}

test('valid pinned owner is accepted',()=>{
 assert.equal(isVitoInteractiveOwner(session,policy),true);
});
test('case-insensitive UUID matches do not grant any other identity',()=>{
 assert.equal(isVitoInteractiveOwner({...session,user:{...session.user,id:userId.toUpperCase()}},policy),true);
 assert.equal(isVitoInteractiveOwner({...session,user:{...session.user,id:otherUser}},policy),false);
});
test('a different user with OWNER organization role remains denied',()=>{
 assert.equal(isVitoInteractiveOwner({...session,user:{...session.user,id:otherUser,role:'OWNER'}},policy),false);
});
test('ADMIN MEMBER and VIEWER organization roles are not private cockpit owner',()=>{
 for(const role of ['ADMIN','MEMBER','VIEWER'] as const)
  assert.equal(isVitoInteractiveOwner({...session,user:{...session.user,role}},policy),false);
});
test('a different authenticated organization denies access',()=>{
 assert.equal(isVitoInteractiveOwner({...session,organization:{...session.organization,id:otherOrg}},policy),false);
});
test('user organization mismatching pinned org denies access',()=>{
 assert.equal(isVitoInteractiveOwner({...session,user:{...session.user,organizationId:otherOrg}},policy),false);
});
test('wrong configured owner ID is denied',()=>{
 assert.equal(isVitoInteractiveOwner(session,{ownerUserId:otherUser,ownerOrganizationId:organizationId}),false);
});
test('missing malformed or partial configuration fails closed',()=>{
 for(const cfg of [{},{ownerUserId:userId},{ownerOrganizationId:organizationId},{ownerUserId:'email@example.com',ownerOrganizationId:organizationId},{ownerUserId:userId,ownerOrganizationId:'x'}])
  assert.equal(isVitoInteractiveOwner(session,cfg),false);
});
test('null and absent sessions fail closed',()=>{
 assert.equal(isVitoInteractiveOwner(null,policy),false);
 assert.equal(isVitoInteractiveOwner(undefined,policy),false);
});
test('server env with absent pinned owner denies even the current OWNER',()=>{
 const beforeUser=process.env.VITO_CONTROL_OWNER_USER_ID,beforeOrg=process.env.VITO_CONTROL_OWNER_ORGANIZATION_ID;
 try{
  delete process.env.VITO_CONTROL_OWNER_USER_ID;
  delete process.env.VITO_CONTROL_OWNER_ORGANIZATION_ID;
  assert.equal(isVitoInteractiveOwner(session),false);
 } finally {
  if(beforeUser===undefined)delete process.env.VITO_CONTROL_OWNER_USER_ID;
  else process.env.VITO_CONTROL_OWNER_USER_ID=beforeUser;
  if(beforeOrg===undefined)delete process.env.VITO_CONTROL_OWNER_ORGANIZATION_ID;
  else process.env.VITO_CONTROL_OWNER_ORGANIZATION_ID=beforeOrg;
 }
});
test('a verified backend lookup of the pinned user and organization is accepted',async()=>{
 const resolved=await resolveVitoOwnerSession(token(),fakeApi(),policy);
 assert.equal(resolved?.user.id,userId);
});
test('untrusted decoded sub is not accepted if backend returns another user',async()=>{
 const resolved=await resolveVitoOwnerSession(token(),fakeApi({...session.user,id:otherUser}),policy);
 assert.equal(resolved,null);
});
test('backend user/organization mismatch is denied',async()=>{
 assert.equal(await resolveVitoOwnerSession(token(),fakeApi({...session.user,organizationId:otherOrg}),policy),null);
 assert.equal(await resolveVitoOwnerSession(token(),fakeApi(session.user,{...activeOrg,id:otherOrg}),policy),null);
});
test('backend response carrying only ADMIN access is denied',async()=>{
 assert.equal(await resolveVitoOwnerSession(token(),fakeApi({...session.user,role:'ADMIN'}),policy),null);
});
test('malformed JWT selector never calls backend',async()=>{
 let reads=0;
 const forbidden={get:async()=>{reads++;throw Error('SHOULD_NOT_READ');}} as unknown as Pick<VitoApiClient,'get'>;
 assert.equal(await resolveVitoOwnerSession('not-a-token',forbidden,policy),null);
 assert.equal(reads,0);
});
test('backend failures are propagated so callers can fail closed',async()=>{
 const broken={get:async()=>{throw Error('backend offline');}} as unknown as Pick<VitoApiClient,'get'>;
 await assert.rejects(resolveVitoOwnerSession(token(),broken,policy),/backend offline/);
});

test('private interactive rollout flag defaults off and requires exact true',()=>{
 assert.equal(isVitoControlOwnerOnlyEnabled({}),false);
 assert.equal(isVitoControlOwnerOnlyEnabled({VITO_CONTROL_OWNER_ONLY:'false'}),false);
 assert.equal(isVitoControlOwnerOnlyEnabled({VITO_CONTROL_OWNER_ONLY:'TRUE'}),false);
 assert.equal(isVitoControlOwnerOnlyEnabled({VITO_CONTROL_OWNER_ONLY:'true'}),true);
});
test('disabled private mode preserves backend-verified non-owner session, never forgery',async()=>{
 const api=fakeApi({...session.user,role:'ADMIN'});
 assert.equal((await resolveVitoSession(token(),api,false))?.user.role,'ADMIN');
 assert.equal(await resolveVitoSession(token(),api,true,policy),null);
 assert.equal(await resolveVitoSession(token(),fakeApi({...session.user,id:otherUser}),false),null);
});
test('enabled private mode denies unknown pins, even for verified OWNER',async()=>{
 assert.equal(await resolveVitoSession(token(),fakeApi(),true,{}),null);
 assert.equal((await resolveVitoSession(token(),fakeApi(),true,policy))?.user.id,userId);
});
