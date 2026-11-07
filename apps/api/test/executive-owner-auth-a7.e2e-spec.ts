/**
 * A7: HTTP-level JWT/tenant/role security gate with real Passport verification,
 * a TEST-ONLY signing key, and an in-memory fake identity database.
 *
 * This does not authenticate a production owner, touch Neon or modify VITO DB.
 */
import 'reflect-metadata';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { CommonModule } from '../src/common/common.module';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { ScopedMachineIdentityGuard } from '../src/common/guards/scoped-machine-identity.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExecutiveReceiptsController } from '../src/modules/executive-receipts/executive-receipts.controller';
import { ExecutiveReceiptsService } from '../src/modules/executive-receipts/executive-receipts.service';
import { isAuthorizedOwnerBusReader } from '../src/modules/executive-receipts/owner-bus.contract';
import { TenantContext } from '../src/common/tenant/tenant-context';

const OWNER_ORG = '13131313-2424-4545-8686-979797979797';
const OTHER_ORG = '57575757-6868-4949-8080-919191919191';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_OWNER_ID = '33333333-3333-4333-8333-333333333333';
const MACHINE_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = 'TEST_ONLY_A7_LOCAL_HS256_SIGNING_KEY_NO_PRODUCTION_SECRETS_20261107';

type Identity = {
  id:string;organizationId:string; role:UserRole; status:'ACTIVE'|'INACTIVE';
  tokenVersion:number;email:string;isMachineIdentity:boolean; machineScope:string|null;
  organization: {id:string;status:'ACTIVE'|'SUSPENDED'};
};

const records = new Map<string, Identity>([
  [OWNER_ID,{id:OWNER_ID,organizationId:OWNER_ORG,role:UserRole.OWNER,status:'ACTIVE',tokenVersion:4,
    email:'owner@example.invalid',isMachineIdentity:false,machineScope:null,
    organization:{id:OWNER_ORG,status:'ACTIVE'}}],
  [ADMIN_ID,{id:ADMIN_ID,organizationId:OWNER_ORG,role:UserRole.ADMIN,status:'ACTIVE',tokenVersion:4,
    email:'admin@example.invalid',isMachineIdentity:false,machineScope:null,
    organization:{id:OWNER_ORG,status:'ACTIVE'}}],
  [OTHER_OWNER_ID,{id:OTHER_OWNER_ID,organizationId:OTHER_ORG,role:UserRole.OWNER,status:'ACTIVE',tokenVersion:4,
    email:'other@example.invalid',isMachineIdentity:false,machineScope:null,
    organization:{id:OTHER_ORG,status:'ACTIVE'}}],
  [MACHINE_ID,{id:MACHINE_ID,organizationId:OWNER_ORG,role:UserRole.OWNER,status:'ACTIVE',tokenVersion:4,
    email:'machine@example.invalid',isMachineIdentity:true,machineScope:'provider.read',
    organization:{id:OWNER_ORG,status:'ACTIVE'}}],
]);

describe('VITO ONE COCKPIT A7: actual Passport JWT + HTTP Owner-only routes', () => {
  let app:INestApplication;
  let moduleRef:TestingModule;
  const prior = {
    secret:process.env.JWT_SECRET,
    org:process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID,
    insecure:process.env.ALLOW_INSECURE_TENANT_HEADER,
  };
  const signer=new JwtService({secret:SECRET});
  const mockDb = {user:{findUnique:jest.fn(async({where}:{where:{id:string}})=>records.get(where.id)??null)}};
  const mockReceipts={
    overview:jest.fn(async(tenant:TenantContext)=>{
      if(!isAuthorizedOwnerBusReader({
        organizationId:tenant.getOrThrow(),
        userId:tenant.getUserId(),
        role:tenant.getRole(),
        authenticationMethod:tenant.getAuthenticationMethod(),
      },OWNER_ORG))throw new ForbiddenException('OWNER_BOUNDARY_DENIED');
      return {organizationId:OWNER_ORG,authority:'READ_ONLY',sourceHealth:'HEALTHY',
        observedAt:new Date().toISOString(),items:[]};
    }),
    reportsOverview:jest.fn(async(tenant:TenantContext)=>{
      if(!isAuthorizedOwnerBusReader({
        organizationId:tenant.getOrThrow(),
        userId:tenant.getUserId(),
        role:tenant.getRole(),
        authenticationMethod:tenant.getAuthenticationMethod(),
      },OWNER_ORG))throw new ForbiddenException('OWNER_BOUNDARY_DENIED');
      return {organizationId:OWNER_ORG,authority:'READ_ONLY',sourceHealth:'HEALTHY',
        observedAt:new Date().toISOString(),reports:[]};
    }),
  };
  function token(id:string, overrides:Record<string,unknown>={}) {
    const rec=records.get(id)!;
    return signer.sign({sub:id,org_id:rec.organizationId,role:rec.role,
      token_version:rec.tokenVersion,...overrides},{noTimestamp:true});
  }
  beforeAll(async()=>{
    process.env.JWT_SECRET=SECRET;
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID=OWNER_ORG;
    delete process.env.ALLOW_INSECURE_TENANT_HEADER;
    moduleRef=await Test.createTestingModule({
      imports:[CommonModule, PassportModule.register({defaultStrategy:'jwt'})],
      controllers:[ExecutiveReceiptsController],
      providers:[
        JwtStrategy,
        {provide:PrismaService,useValue:mockDb},
        {provide:ExecutiveReceiptsService,useValue:mockReceipts},
        {provide:APP_GUARD,useClass:JwtAuthGuard},
        {provide:APP_GUARD,useClass:ScopedMachineIdentityGuard},
        {provide:APP_GUARD,useClass:RolesGuard},
      ],
    }).compile();
    app=moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async()=>{
    await app?.close();
    await moduleRef?.close();
    for(const [env,v] of [
      ['JWT_SECRET',prior.secret],
      ['VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID',prior.org],
      ['ALLOW_INSECURE_TENANT_HEADER',prior.insecure],
    ] as const) {
      if(v===undefined)delete process.env[env];
      else process.env[env]=v;
    }
  });
  beforeEach(()=>{
    mockDb.user.findUnique.mockClear();
    mockReceipts.overview.mockClear();
    mockReceipts.reportsOverview.mockClear();
    records.get(OWNER_ID)!.status='ACTIVE';
    records.get(OWNER_ID)!.tokenVersion=4;
    records.get(OWNER_ID)!.organization.status='ACTIVE';
  });
  const endpoint='/executive/receipts';
  it('unsigned requests are 401, never reach source',async()=>{
    await request(app.getHttpServer()).get(endpoint).expect(401);
    expect(mockReceipts.overview).not.toHaveBeenCalled();
  });
  it('an authenticated, signed Owner reaches read-only receipts',async()=>{
    const r=await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(OWNER_ID)).expect(200);
    expect(r.body.authority).toBe('READ_ONLY');
    expect(r.body.organizationId).toBe(OWNER_ORG);
    expect(mockReceipts.overview).toHaveBeenCalledTimes(1);
  });
  it('the same signed Owner can access specialist reports',async()=>{
    const r=await request(app.getHttpServer()).get('/executive/reports')
      .set('Authorization','Bearer '+token(OWNER_ID)).expect(200);
    expect(r.body.reports).toEqual([]);
    expect(mockReceipts.reportsOverview).toHaveBeenCalledTimes(1);
  });
  it('tampered signature is 401',async()=>{
    const t=token(OWNER_ID);
    const parts=t.split('.');
    const last=parts[2];
    parts[2]=(last[0]==='A'?'B':'A')+last.slice(1);
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+parts.join('.')).expect(401);
  });
  it('expired but correctly signed token is 401',async()=>{
    const expired=token(OWNER_ID,{exp:Math.floor(Date.now()/1000)-60});
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+expired).expect(401);
  });
  it('real database ADMIN role denies even token forged with OWNER role claim',async()=>{
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(ADMIN_ID,{role:'OWNER'})).expect(403);
  });
  it('a different active organization OWNER is denied at the second tenant gate',async()=>{
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(OTHER_OWNER_ID)).expect(403);
  });
  it('a signed foreign organization claim mismatching database membership is 401',async()=>{
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(OWNER_ID,{org_id:OTHER_ORG})).expect(401);
  });
  it('a stale token_version is 401',async()=>{
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(OWNER_ID,{token_version:3})).expect(401);
  });
  it('a deactivated Owner is 401 even with existing signature',async()=>{
    const t=token(OWNER_ID);
    records.get(OWNER_ID)!.status='INACTIVE';
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+t).expect(401);
  });
  it('suspended organization is 401',async()=>{
    const t=token(OWNER_ID);
    records.get(OWNER_ID)!.organization.status='SUSPENDED';
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+t).expect(401);
  });
  it('a machine identity with OWNER role cannot read an unscoped executive endpoint',async()=>{
    await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(MACHINE_ID)).expect(403);
  });
  it('X-Organization-Id cannot override a verified Owner JWT',async()=>{
    const r=await request(app.getHttpServer()).get(endpoint)
      .set('Authorization','Bearer '+token(OWNER_ID))
      .set('X-Organization-Id',OTHER_ORG).expect(200);
    expect(r.body.organizationId).toBe(OWNER_ORG);
  });
  it('insecure tenant header fallback cannot access OWNER-only routes',async()=>{
    process.env.ALLOW_INSECURE_TENANT_HEADER='true';
    try{
      await request(app.getHttpServer()).get(endpoint)
        .set('X-Organization-Id',OWNER_ORG).expect(403);
    }finally{
      delete process.env.ALLOW_INSECURE_TENANT_HEADER;
    }
  });
});
