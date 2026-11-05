import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../../../common/tenant/tenant-context';
import { JwtAuthGuard } from './jwt-auth.guard';

const organizationId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function ctx():ExecutionContext {
 const req={headers:{},header:(name:string)=>name==='x-organization-id'?organizationId:undefined};
 return {
  switchToHttp:()=>({getRequest:()=>req}),
  getHandler:()=>function handler(){},
  getClass:()=>class Controller{},
 } as unknown as ExecutionContext;
}
function guard() {
 return new JwtAuthGuard({getAllAndOverride:()=>false} as unknown as Reflector,new TenantContext());
}
describe('VITO private human mode disables unsigned tenant-header fallback',()=>{
 const keys=['ALLOW_INSECURE_TENANT_HEADER','VITO_PRIVATE_HUMAN_API_OWNER_ONLY'] as const;
 let previous:Record<string,string|undefined>;
 beforeEach(()=>{previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));});
 afterEach(()=>{for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
 it('rejects insecure header even in non-production when owner-only API mode enabled',async()=>{
  process.env.ALLOW_INSECURE_TENANT_HEADER='true';
  process.env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY='true';
  await expect(guard().canActivate(ctx())).rejects.toThrow(UnauthorizedException);
 });
 it('preserves existing isolated dev-only fallback when private mode disabled',async()=>{
  process.env.ALLOW_INSECURE_TENANT_HEADER='true';
  process.env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY='false';
  const g=guard();
  await expect(g.canActivate(ctx())).resolves.toBe(true);
 });
 it('rejects insecure header when development fallback not enabled',async()=>{
  process.env.ALLOW_INSECURE_TENANT_HEADER='false';
  process.env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY='false';
  await expect(guard().canActivate(ctx())).rejects.toThrow(UnauthorizedException);
 });
});
