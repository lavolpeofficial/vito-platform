/**
 * VITO A7 login-to-executive HTTP test with the real AuthService.login(),
 * bcrypt password verification, JWT signing and real Passport JWT guards.
 * All identity/DB fixtures are TEST ONLY; no production login or secrets.
 */
import 'reflect-metadata';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { CommonModule } from '../src/common/common.module';
import { ScopedMachineIdentityGuard } from '../src/common/guards/scoped-machine-identity.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { ExecutiveReceiptsController } from '../src/modules/executive-receipts/executive-receipts.controller';
import { ExecutiveReceiptsService } from '../src/modules/executive-receipts/executive-receipts.service';
import { isAuthorizedOwnerBusReader } from '../src/modules/executive-receipts/owner-bus.contract';
import { PrismaService } from '../src/prisma/prisma.service';

const OWNER_ORG = '13131313-2424-4545-8686-979797979797';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'TEST_ONLY_A7_PASSWORD_LOGIN_JWT_NEVER_USE_PRODUCTION_20261107';
const PASSWORD = 'fixture-only-not-a-real-account-password';
const SLUG = 'vito-private-auth-test';

describe('VITO A7: real password login issues signed JWT accepted by Owner-only HTTP route',()=>{
  let app:INestApplication;
  let fixture:TestingModule;
  const before={secret:process.env.JWT_SECRET,owner:process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID,
    insecure:process.env.ALLOW_INSECURE_TENANT_HEADER};
  const owner={
    id:OWNER_ID,organizationId:OWNER_ORG,role:UserRole.OWNER,status:'ACTIVE',
    tokenVersion:3,email:'owner@example.invalid',firstName:'Test',lastName:'Owner',
    passwordHash:bcrypt.hashSync(PASSWORD,5),isMachineIdentity:false,machineScope:null,
    organization:{id:OWNER_ORG,status:'ACTIVE'},
  };
  const admin={...owner,id:ADMIN_ID,role:UserRole.ADMIN,email:'admin@example.invalid'};
  const users=[owner,admin];
  const db={
    organization:{findUnique:jest.fn(async({where}:{where:{slug:string}})=>
      where.slug===SLUG?{id:OWNER_ORG,slug:SLUG,status:'ACTIVE'}:null)},
    user:{
      findFirst:jest.fn(async({where}:{where:{organizationId:string;email:string}})=>
        users.find(u=>u.organizationId===where.organizationId&&u.email===where.email)??null),
      findUnique:jest.fn(async({where}:{where:{id:string}})=>users.find(u=>u.id===where.id)??null),
      update:jest.fn(async()=>({})),
    },
  };
  const mockReceipts={
    overview:jest.fn(async(tenant:TenantContext)=>{
      if(!isAuthorizedOwnerBusReader({organizationId:tenant.getOrThrow(),userId:tenant.getUserId(),
        role:tenant.getRole(),authenticationMethod:tenant.getAuthenticationMethod()},OWNER_ORG)){
        throw new ForbiddenException('OWNER_BOUNDARY_DENIED');
      }
      return {organizationId:OWNER_ORG,authority:'READ_ONLY',sourceHealth:'HEALTHY',
        observedAt:new Date().toISOString(),items:[]};
    }),
    reportsOverview:jest.fn(async(tenant:TenantContext)=>{
      if(!isAuthorizedOwnerBusReader({organizationId:tenant.getOrThrow(),userId:tenant.getUserId(),
        role:tenant.getRole(),authenticationMethod:tenant.getAuthenticationMethod()},OWNER_ORG)){
        throw new ForbiddenException('OWNER_BOUNDARY_DENIED');
      }
      return {organizationId:OWNER_ORG,authority:'READ_ONLY',sourceHealth:'HEALTHY',
        observedAt:new Date().toISOString(),reports:[]};
    }),
  };
  const loginBody=(email=owner.email,password=PASSWORD)=>({organizationSlug:SLUG,email,password});
  beforeAll(async()=>{
    process.env.JWT_SECRET=SECRET;
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID=OWNER_ORG;
    delete process.env.ALLOW_INSECURE_TENANT_HEADER;
    fixture=await Test.createTestingModule({
      imports:[
        CommonModule,
        PassportModule.register({defaultStrategy:'jwt'}),
        JwtModule.register({secret:SECRET,signOptions:{expiresIn:'15m'}}),
        ThrottlerModule.forRoot([{ttl:60_000,limit:50}]),
      ],
      controllers:[AuthController,ExecutiveReceiptsController],
      providers:[
        AuthService,JwtStrategy,
        {provide:PrismaService,useValue:db},
        {provide:ExecutiveReceiptsService,useValue:mockReceipts},
        {provide:APP_GUARD,useClass:JwtAuthGuard},
        {provide:APP_GUARD,useClass:ScopedMachineIdentityGuard},
        {provide:APP_GUARD,useClass:RolesGuard},
      ],
    }).compile();
    app=fixture.createNestApplication();
    await app.init();
  });
  afterAll(async()=>{
    await app?.close();
    await fixture?.close();
    const p:[string,string|undefined][]=[
      ['JWT_SECRET',before.secret],['VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID',before.owner],
      ['ALLOW_INSECURE_TENANT_HEADER',before.insecure],
    ];
    for(const [key,v] of p){if(v===undefined)delete process.env[key];else process.env[key]=v;}
  });
  beforeEach(()=>{
    owner.status='ACTIVE'; owner.tokenVersion=3; owner.organization.status='ACTIVE';
    db.user.update.mockClear();
    mockReceipts.overview.mockClear();
  });
  it('POST /auth/login issues a signed bearer JWT, then both Owner endpoints return 200',async()=>{
    const response=await request(app.getHttpServer()).post('/auth/login')
      .send(loginBody()).expect(200);
    expect(response.body.tokenType).toBe('Bearer');
    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.user.role).toBe('OWNER');
    expect(db.user.update).toHaveBeenCalled();
    const jwt=response.body.accessToken as string;
    const handoffs=await request(app.getHttpServer()).get('/executive/receipts')
      .set('Authorization','Bearer '+jwt).expect(200);
    expect(handoffs.body.authority).toBe('READ_ONLY');
    const reports=await request(app.getHttpServer()).get('/executive/reports')
      .set('Authorization','Bearer '+jwt).expect(200);
    expect(reports.body.sourceHealth).toBe('HEALTHY');
  });
  it('wrong password does not issue JWT or alter login date',async()=>{
    db.user.update.mockClear();
    const response=await request(app.getHttpServer()).post('/auth/login')
      .send(loginBody(owner.email,'invalid-test-password')).expect(401);
    expect(response.body.accessToken).toBeUndefined();
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('unknown organization returns 401 without issuing tokens',async()=>{
    await request(app.getHttpServer()).post('/auth/login')
      .send({...loginBody(),organizationSlug:'unknown-test-tenant'}).expect(401);
  });
  it('ADMIN login is legitimate but the executive routes still return 403',async()=>{
    const response=await request(app.getHttpServer()).post('/auth/login')
      .send(loginBody(admin.email)).expect(200);
    await request(app.getHttpServer()).get('/executive/receipts')
      .set('Authorization','Bearer '+response.body.accessToken).expect(403);
  });
  it('old real-login JWT is refused after the token version changes in the fake DB',async()=>{
    const response=await request(app.getHttpServer()).post('/auth/login')
      .send(loginBody()).expect(200);
    owner.tokenVersion++;
    await request(app.getHttpServer()).get('/executive/receipts')
      .set('Authorization','Bearer '+response.body.accessToken).expect(401);
  });
});
