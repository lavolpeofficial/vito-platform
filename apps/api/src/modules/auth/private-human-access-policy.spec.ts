import assert from 'node:assert/strict';
import {
  canAccessPrivateVitoApi,
  canUsePrivateVitoHumanLogin,
  privateHumanAccessConfigFromEnv,
} from './private-human-access-policy';

const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orgId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const otherOrg='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const enabled={enabled:true,ownerUserId:ownerId,ownerOrganizationId:orgId};
const owner={id:ownerId,organizationId:orgId,role:'OWNER',isMachineIdentity:false,machineScope:null};
const machine={id:otherId,organizationId:otherOrg,role:'MEMBER',isMachineIdentity:true,machineScope:'operator:tasks'};

test('disabled mode preserves existing legitimate human/machine access',()=>{
 assert.equal(canAccessPrivateVitoApi(owner,{enabled:false}),true);
 assert.equal(canAccessPrivateVitoApi({...owner,id:otherId,role:'ADMIN'},{enabled:false}),true);
 assert.equal(canAccessPrivateVitoApi(machine,{enabled:false}),true);
 assert.equal(canUsePrivateVitoHumanLogin({...owner,id:otherId},{enabled:false}),true);
});
test('enabled mode accepts exactly the pinned private human owner',()=>{
 assert.equal(canAccessPrivateVitoApi(owner,enabled),true);
 assert.equal(canUsePrivateVitoHumanLogin(owner,enabled),true);
});
test('another organization OWNER is rejected at the API boundary',()=>{
 assert.equal(canAccessPrivateVitoApi({...owner,id:otherId,role:'OWNER'},enabled),false);
 assert.equal(canAccessPrivateVitoApi({...owner,organizationId:otherOrg},enabled),false);
});
test('same person as ADMIN is rejected in owner-only mode',()=>{
 for(const role of ['ADMIN','MEMBER','VIEWER'])assert.equal(canAccessPrivateVitoApi({...owner,role},enabled),false);
});
test('unconfigured private owner fails closed for human principals',()=>{
 for(const cfg of [{enabled:true},{enabled:true,ownerUserId:ownerId},{enabled:true,ownerOrganizationId:orgId}])
  assert.equal(canAccessPrivateVitoApi(owner,cfg),false);
});
test('email/slug are not accepted as owner identifiers',()=>{
 assert.equal(canAccessPrivateVitoApi(owner,{enabled:true,ownerUserId:'test@example.invalid',ownerOrganizationId:orgId}),false);
 assert.equal(canAccessPrivateVitoApi(owner,{enabled:true,ownerUserId:ownerId,ownerOrganizationId:'la-volpe'}),false);
});
test('synthetic machine identity with a nonempty scope keeps API admission',()=>{
 assert.equal(canAccessPrivateVitoApi(machine,enabled),true);
});
test('machine identities never use interactive human password login',()=>{
 assert.equal(canUsePrivateVitoHumanLogin(machine,enabled),false);
});
test('fake/unscoped machine identities are rejected in private mode',()=>{
 assert.equal(canAccessPrivateVitoApi({...machine,machineScope:''},enabled),false);
 assert.equal(canAccessPrivateVitoApi({...machine,machineScope:null},enabled),false);
});
test('contradictory human identity classification is rejected',()=>{
 assert.equal(canAccessPrivateVitoApi({...owner,machineScope:'operator:tasks'},enabled),false);
 assert.equal(canAccessPrivateVitoApi({...owner,isMachineIdentity:undefined} as never,enabled),false);
});
test('a missing verified principal always denies',()=>{
 assert.equal(canAccessPrivateVitoApi(null,enabled),false);
 assert.equal(canUsePrivateVitoHumanLogin(undefined,enabled),false);
});
test('owner UUID casing is canonicalized safely',()=>{
 assert.equal(canAccessPrivateVitoApi(owner,{enabled:true,ownerUserId:ownerId.toUpperCase(),ownerOrganizationId:orgId.toUpperCase()}),true);
});
test('config reads only exact server env feature flag and pins',()=>{
 const cfg=privateHumanAccessConfigFromEnv({
  VITO_PRIVATE_HUMAN_API_OWNER_ONLY:'true',
  VITO_PRIVATE_HUMAN_OWNER_USER_ID:ownerId,
  VITO_PRIVATE_HUMAN_OWNER_ORGANIZATION_ID:orgId,
 });
 assert.deepEqual(cfg,enabled);
 assert.equal(privateHumanAccessConfigFromEnv({VITO_PRIVATE_HUMAN_API_OWNER_ONLY:'TRUE'}).enabled,false);
});
test('a nonowner with another organization can never bypass role comparison',()=>{
 const impostor={...owner,id:otherId,organizationId:otherOrg,role:'OWNER'};
 assert.equal(canUsePrivateVitoHumanLogin(impostor,enabled),false);
});
