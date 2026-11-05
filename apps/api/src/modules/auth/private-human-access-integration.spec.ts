import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orgId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const password='vito-test-password-not-real';
const hash=bcrypt.hashSync(password,4);
const org={id:orgId,slug:'la-volpe',status:'ACTIVE'};
const owner={id:ownerId,organizationId:orgId,role:UserRole.OWNER,status:'ACTIVE',
 tokenVersion:1,isMachineIdentity:false,machineScope:null,passwordHash:hash,
 email:'owner@example.invalid',firstName:'Test',lastName:'Owner',organization:org};
const otherOwner={...owner,id:otherId,email:'other@example.invalid'};
const machine={...owner,id:otherId,email:'machine@example.invalid',role:UserRole.MEMBER,
 isMachineIdentity:true,machineScope:'operator:tasks'};
const keys=['VITO_PRIVATE_HUMAN_API_OWNER_ONLY','VITO_PRIVATE_HUMAN_OWNER_USER_ID',
 'VITO_PRIVATE_HUMAN_OWNER_ORGANIZATION_ID','JWT_SECRET'] as const;
let old:Record<string,string|undefined>;
beforeEach(()=>{
 old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 process.env.JWT_SECRET='unit-test-jwt-secret-do-not-deploy';
 process.env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY='true';
 process.env.VITO_PRIVATE_HUMAN_OWNER_USER_ID=ownerId;
 process.env.VITO_PRIVATE_HUMAN_OWNER_ORGANIZATION_ID=orgId;
});
afterEach(()=>{
 for(const k of keys){
  if(old[k]===undefined)delete process.env[k];
  else process.env[k]=old[k];
 }
});
function jwtFixture(user:typeof owner){
 const prisma={user:{findUnique:jest.fn().mockResolvedValue(user)}} as unknown as PrismaService;
 return new JwtStrategy(prisma);
}
function credentials(email='owner@example.invalid'){
 return {email,password,organizationSlug:'la-volpe'};
}
function loginFixture(user:typeof owner){
 const prisma={
  organization:{findUnique:jest.fn().mockResolvedValue(org)},
  user:{findFirst:jest.fn().mockResolvedValue(user),update:jest.fn().mockResolvedValue(user)},
 } as unknown as PrismaService;
 const jwt={signAsync:jest.fn().mockResolvedValue('synthetic.test.jwt')} as unknown as JwtService;
 return new AuthService(prisma,jwt);
}
function payload(user:typeof owner){
 return {sub:user.id,org_id:user.organizationId,role:user.role,token_version:user.tokenVersion};
}

describe('private VITO human identity wiring (synthetic, no network)',()=>{
 it('accepts the unique DB-verified owner JWT',async()=>{
  const result=await jwtFixture(owner).validate(payload(owner));
  expect(result.userId).toBe(ownerId);
  expect(result.organizationId).toBe(orgId);
 });
 it('rejects a second valid organization OWNER JWT',async()=>{
  await expect(jwtFixture(otherOwner).validate(payload(otherOwner)))
   .rejects.toThrow(UnauthorizedException);
 });
 it('rejects the owner identity if downgraded to ADMIN by the database',async()=>{
  const admin={...owner,role:UserRole.ADMIN};
  await expect(jwtFixture(admin).validate(payload(admin)))
   .rejects.toThrow(UnauthorizedException);
 });
 it('allows an existing scoped machine identity to reach its ordinary machine guard',async()=>{
  const result=await jwtFixture(machine).validate(payload(machine));
  expect(result.isMachineIdentity).toBe(true);
  expect(result.machineScope).toBe('operator:tasks');
 });
 it('refuses forged unscoped machine identity at JWT validation',async()=>{
  const invalid={...machine,machineScope:null};
  await expect(jwtFixture(invalid).validate(payload(invalid)))
   .rejects.toThrow(UnauthorizedException);
 });
 it('preserves the previous JWT behavior when the private feature flag is not enabled',async()=>{
  process.env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY='false';
  const result=await jwtFixture(otherOwner).validate(payload(otherOwner));
  expect(result.userId).toBe(otherId);
 });
 it('allows the pinned owner through existing password login',async()=>{
  const result=await loginFixture(owner).login(credentials());
  expect(result.user.id).toBe(ownerId);
 });
 it('rejects second human OWNER during password login before token issuance',async()=>{
  await expect(loginFixture(otherOwner).login(credentials('other@example.invalid')))
   .rejects.toThrow(UnauthorizedException);
 });
 it('rejects a machine principal from interactive password login',async()=>{
  await expect(loginFixture(machine).login(credentials('machine@example.invalid')))
   .rejects.toThrow(UnauthorizedException);
 });
 it('rejects the legitimate owner if the owner config is incomplete',async()=>{
  delete process.env.VITO_PRIVATE_HUMAN_OWNER_ORGANIZATION_ID;
  await expect(loginFixture(owner).login(credentials())).rejects.toThrow(UnauthorizedException);
 });
 it('does not change original nonprivate login behavior',async()=>{
  process.env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY='false';
  const result=await loginFixture(otherOwner).login(credentials('other@example.invalid'));
  expect(result.user.id).toBe(otherId);
 });
});
