import { ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { configureBodyParsers, createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { computeRequestFingerprint } from '../src/modules/operator-bridge/idempotency';
import { CommonModule } from '../src/common/common.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaModule } from '../src/prisma/prisma.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { HealthModule } from '../src/modules/health/health.module';
import { TasksModule } from '../src/modules/tasks/tasks.module';
import { AuditModule } from '../src/modules/audit/audit.module';
import { AgentWorkforceService } from '../src/modules/agent-workforce/agent-workforce.service';
import { OperatorBridgeController } from '../src/modules/operator-bridge/operator-bridge.controller';
import { OperatorBridgeService } from '../src/modules/operator-bridge/operator-bridge.service';
import {
  OPERATOR_BRIDGE_CONFIG,
  loadOperatorBridgeConfig,
} from '../src/modules/operator-bridge/operator-bridge.config';

// Test-Environment: bewusst NICHT NODE_ENV=production, damit der
// Insecure-Header-Fallback-Test unten (mit ALLOW_INSECURE_TENANT_HEADER)
// den Bootstrap-Schutz in main.ts nicht auslöst. JWT_SECRET wird nur
// gesetzt, falls die Umgebung noch keinen eigenen Wert vorgibt.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-only-jwt-secret-do-not-use-in-production';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
process.env.ALLOW_INSECURE_TENANT_HEADER = process.env.ALLOW_INSECURE_TENANT_HEADER ?? 'false';
process.env.ENABLE_SWAGGER = process.env.ENABLE_SWAGGER ?? 'false';
process.env.OPERATOR_BRIDGE_EXPOSURE = process.env.OPERATOR_BRIDGE_EXPOSURE ?? 'internal';
process.env.SENSITIVE_PAYLOAD_TTL_HOURS = process.env.SENSITIVE_PAYLOAD_TTL_HOURS ?? '72';

const DEFAULT_PASSWORD = 'Sup3rSecretPassw0rd!';
// Niedrige bcrypt-Kostenstufe ausschließlich in Tests, um die Laufzeit
// gering zu halten. AuthService selbst nutzt weiterhin einen sicheren
// Standard (siehe AuthService/seed.ts).
const TEST_BCRYPT_COST = 4;

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DISABLED';
type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

describe('VITO API (e2e)', () => {
  let app: NestExpressApplication;
  let httpServer: any;
  let prisma: PrismaService;
  let jwtService: JwtService;

  beforeAll(async () => {
    if (process.env.OPERATOR_BRIDGE_E2E_ONLY === 'true') {
      const moduleRef = await Test.createTestingModule({
        imports: [CommonModule, PrismaModule, AuthModule, HealthModule, TasksModule, AuditModule],
        controllers: [OperatorBridgeController],
        providers: [
          OperatorBridgeService,
          {
            provide: AgentWorkforceService,
            useValue: {
              dispatch: jest.fn(() => {
                throw new Error('Unexpected dispatch in composed authorization E2E.');
              }),
            },
          },
          {
            provide: OPERATOR_BRIDGE_CONFIG,
            useFactory: loadOperatorBridgeConfig,
          },
        ],
      }).compile();
      app = moduleRef.createNestApplication<NestExpressApplication>();
      configureBodyParsers(app);
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      app.useGlobalFilters(new HttpExceptionFilter());
    } else {
      app = await createApp();
    }
    await app.init();
    httpServer = app.getHttpServer();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- Test-Helfer -------------------------------------------------------

  /**
   * Legt eine Organization + einen initialen User DIREKT über Prisma an
   * (bewusst nicht über die API, da POST /organizations und POST /users
   * jetzt Authentifizierung voraussetzen — dieser Helfer löst genau das
   * Henne-Ei-Problem für Testdaten) und liefert die Zugangsdaten für einen
   * echten Login über POST /auth/login zurück.
   */
  async function bootstrapOrgWithUser(
    opts: {
      role?: Role;
      userStatus?: UserStatus;
      orgStatus?: OrgStatus;
      password?: string;
      isMachineIdentity?: boolean;
      machineScope?: string | null;
    } = {},
  ) {
    const suffix = randomUUID().slice(0, 8);
    const org = await prisma.organization.create({
      data: { name: `Test Org ${suffix}`, slug: `test-org-${suffix}`, status: opts.orgStatus ?? 'ACTIVE' },
    });

    const password = opts.password ?? DEFAULT_PASSWORD;
    const passwordHash = await bcrypt.hash(password, TEST_BCRYPT_COST);
    const email = `user-${randomUUID().slice(0, 8)}@example.com`;

    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email,
        firstName: 'Test',
        lastName: 'User',
        role: opts.role ?? 'OWNER',
        status: opts.userStatus ?? 'ACTIVE',
        passwordHash,
        isMachineIdentity: opts.isMachineIdentity ?? false,
        machineScope: opts.machineScope ?? null,
      },
    });

    return { org, user, email, password };
  }

  function login(email: string, password: string, organizationSlug: string) {
    return request(httpServer).post('/auth/login').send({ email, password, organizationSlug });
  }

  async function loginOrFail(email: string, password: string, organizationSlug: string): Promise<string> {
    const res = await login(email, password, organizationSlug).expect(200);
    expect(res.body.accessToken).toBeDefined();
    return res.body.accessToken as string;
  }

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function tokenFor(user: { id: string; role: Role; tokenVersion: number }, organizationId: string) {
    return jwtService.signAsync({
      sub: user.id,
      org_id: organizationId,
      role: user.role,
      token_version: user.tokenVersion,
    });
  }

  // ========================================================================
  // 1. Health Endpoint (öffentlich)
  // ========================================================================
  it('GET /health antwortet erfolgreich, ohne Token', async () => {
    const res = await request(httpServer).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  describe('VITO-OB-001 Operator Bridge authorization and composed API', () => {
    const operatorRequest = () => ({
      requestId: randomUUID(),
      capabilityCode: 'CODE_BUILD',
      prompt: 'Return the cached governed result.',
      assuranceLevel: 'AL-3',
      budget: { maxDurationMs: 120_000, maxTokens: 1000, maxCostMinorUnits: 50 },
    });

    async function bridgeMachine(machineScope: string | null = 'vito-bridge') {
      const tenant = await bootstrapOrgWithUser({
        role: 'MEMBER',
        isMachineIdentity: true,
        machineScope,
      });
      return { ...tenant, token: await tokenFor(tenant.user, tenant.org.id) };
    }

    async function persistCachedTask(
      tenant: Awaited<ReturnType<typeof bridgeMachine>>,
      dto: ReturnType<typeof operatorRequest>,
    ) {
      return prisma.operatorTask.create({
        data: {
          organizationId: tenant.org.id,
          userId: tenant.user.id,
          requestId: dto.requestId,
          requestFingerprint: computeRequestFingerprint(dto),
          correlationId: randomUUID(),
          workflowRunId: randomUUID(),
          workflowStepRunId: randomUUID(),
          capabilityCode: dto.capabilityCode,
          prompt: dto.prompt,
          assuranceLevel: dto.assuranceLevel,
          status: 'COMPLETED',
          maxDurationMs: dto.budget.maxDurationMs,
          maxTokens: dto.budget.maxTokens,
          maxCostMinorUnits: dto.budget.maxCostMinorUnits,
          reviewRequired: false,
          sensitivePayloadExpiresAt: new Date(Date.now() + 60_000),
        },
      });
    }

    it('allows a vito-bridge machine on both bridge endpoints', async () => {
      const machine = await bridgeMachine();
      const dto = operatorRequest();
      const cached = await persistCachedTask(machine, dto);

      await request(httpServer)
        .post('/v1/operator/tasks')
        .set(bearer(machine.token))
        .send(dto)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({ taskId: cached.id, status: 'COMPLETED' });
        });
      await request(httpServer)
        .get(`/v1/operator/tasks/${cached.id}`)
        .set(bearer(machine.token))
        .expect(200)
        .expect(({ body }) => {
          expect(body.taskId).toBe(cached.id);
          expect(body.sensitivePayloadAvailable).toBe(true);
        });
    });

    it('accepts the approved 512 KiB prompt through the HTTP parser and DTO boundary', async () => {
      const machine = await bridgeMachine();
      const dto = { ...operatorRequest(), prompt: '\u0001'.repeat(512 * 1024) };
      const cached = await persistCachedTask(machine, dto);

      await request(httpServer)
        .post('/v1/operator/tasks')
        .set(bearer(machine.token))
        .send(dto)
        .expect(200)
        .expect(({ body }) => expect(body.taskId).toBe(cached.id));
    });

    it('rejects a prompt beyond 512 KiB at the HTTP DTO boundary', async () => {
      const machine = await bridgeMachine();
      await request(httpServer)
        .post('/v1/operator/tasks')
        .set(bearer(machine.token))
        .send({ ...operatorRequest(), prompt: 'a'.repeat(512 * 1024 + 1) })
        .expect(400);
    });

    it('denies the bridge machine from unrelated MEMBER and public endpoints', async () => {
      const machine = await bridgeMachine();
      await request(httpServer)
        .post('/tasks')
        .set(bearer(machine.token))
        .send({ title: 'Must be denied' })
        .expect(403);
      await request(httpServer).get('/health').set(bearer(machine.token)).expect(403);
      await request(httpServer).get('/health').expect(200);
      await request(httpServer)
        .get('/health')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('preserves ordinary MEMBER behavior and keeps bridge routes machine-only', async () => {
      const human = await bootstrapOrgWithUser({ role: 'MEMBER' });
      const token = await tokenFor(human.user, human.org.id);
      await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Existing MEMBER behavior' })
        .expect(201);
      await request(httpServer)
        .post('/v1/operator/tasks')
        .set(bearer(token))
        .send(operatorRequest())
        .expect(403);
    });

    it.each([null, '', 'wrong-machine-scope'])(
      'denies a machine with non-authorized scope %p from bridge routes',
      async (machineScope) => {
        const machine = await bridgeMachine(machineScope);
        await request(httpServer)
          .post('/v1/operator/tasks')
          .set(bearer(machine.token))
          .send(operatorRequest())
          .expect(403);
      },
    );

    it('returns 404 for a cross-tenant bridge task lookup', async () => {
      const owner = await bridgeMachine();
      const other = await bridgeMachine();
      const cached = await persistCachedTask(owner, operatorRequest());
      await request(httpServer)
        .get(`/v1/operator/tasks/${cached.id}`)
        .set(bearer(other.token))
        .expect(404);
    });

    it('revokes machine access through tokenVersion and suspension without human downgrade', async () => {
      const versioned = await bridgeMachine();
      await prisma.user.update({
        where: { id: versioned.user.id },
        data: { tokenVersion: { increment: 1 } },
      });
      await request(httpServer)
        .post('/v1/operator/tasks')
        .set(bearer(versioned.token))
        .send(operatorRequest())
        .expect(401);

      const suspended = await bridgeMachine();
      await prisma.user.update({ where: { id: suspended.user.id }, data: { status: 'SUSPENDED' } });
      await request(httpServer)
        .post('/v1/operator/tasks')
        .set(bearer(suspended.token))
        .send(operatorRequest())
        .expect(401);

      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: suspended.user.id } });
      expect(persisted).toMatchObject({
        isMachineIdentity: true,
        machineScope: 'vito-bridge',
      });
    });

    it('does not disclose machine classification or scope in login responses', async () => {
      const machine = await bridgeMachine();
      const response = await login(machine.email, machine.password, machine.org.slug).expect(200);
      expect(response.body.user.isMachineIdentity).toBeUndefined();
      expect(response.body.user.machineScope).toBeUndefined();
    });
  });

  // ========================================================================
  // 2. Login
  // ========================================================================
  describe('POST /auth/login', () => {
    it('liefert bei korrekten Daten ein JWT und keine sensiblen Felder', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });

      const res = await login(email, password, org.slug).expect(200);

      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.tokenType).toBe('Bearer');
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.passwordHash).toBeUndefined();

      // Payload grob prüfen (sub/org_id/role), ohne die Signatur zu verifizieren.
      const payload = jwtService.decode(res.body.accessToken) as Record<string, unknown>;
      expect(payload.org_id).toBe(org.id);
      expect(payload.role).toBe('OWNER');
      expect(payload.token_version).toBe(1);
    });

    it('lehnt Login mit falschem Passwort ab (401, generische Meldung)', async () => {
      const { org, email } = await bootstrapOrgWithUser();
      const res = await login(email, 'definitely-wrong-password', org.slug).expect(401);
      expect(res.body.statusCode).toBe(401);
      expect(res.body.message).toBe('Ungültige Zugangsdaten.');
    });

    it('lehnt Login mit falschem organizationSlug neutral ab (gleiche Meldung wie falsches Passwort)', async () => {
      const { email, password } = await bootstrapOrgWithUser();
      const res = await login(email, password, `no-such-org-${randomUUID().slice(0, 8)}`).expect(401);
      expect(res.body.statusCode).toBe(401);
      expect(res.body.message).toBe('Ungültige Zugangsdaten.');
    });

    it('lehnt SUSPENDED User trotz korrektem Passwort ab', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ userStatus: 'SUSPENDED' });
      const res = await login(email, password, org.slug).expect(401);
      expect(res.body.message).toBe('Ungültige Zugangsdaten.');
    });

    it('lehnt Login in einer SUSPENDED Organization ab', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ orgStatus: 'SUSPENDED' });
      const res = await login(email, password, org.slug).expect(401);
      expect(res.body.message).toBe('Ungültige Zugangsdaten.');
    });
  });

  // ========================================================================
  // 3. Schutz der Endpunkte / Tenant-Grenzen
  // ========================================================================
  describe('Schutz der Endpunkte und Tenant-Grenzen', () => {
    it('liefert 401 für einen geschützten Endpunkt ohne Token', async () => {
      await request(httpServer).get('/tasks').expect(401);
    });

    it('erlaubt Zugriff innerhalb der eigenen Organization mit gültigem Token', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer).get('/tasks').set(bearer(token)).expect(200);
    });

    it('verhindert, dass ein Token einer Organization auf Daten einer anderen Organization zugreift', async () => {
      const orgA = await bootstrapOrgWithUser({ role: 'OWNER' });
      const orgB = await bootstrapOrgWithUser({ role: 'OWNER' });

      const tokenA = await loginOrFail(orgA.email, orgA.password, orgA.org.slug);
      const tokenB = await loginOrFail(orgB.email, orgB.password, orgB.org.slug);

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(tokenA))
        .send({ title: 'Nur für Org A sichtbar' })
        .expect(201);

      await request(httpServer).get(`/tasks/${task.body.id}`).set(bearer(tokenB)).expect(404);
    });

    it('X-Organization-Id überschreibt niemals die Organization aus einem gültigen JWT', async () => {
      const orgA = await bootstrapOrgWithUser({ role: 'OWNER' });
      const orgB = await bootstrapOrgWithUser({ role: 'OWNER' });
      const tokenA = await loginOrFail(orgA.email, orgA.password, orgA.org.slug);

      const res = await request(httpServer)
        .post('/tasks')
        .set(bearer(tokenA))
        .set('X-Organization-Id', orgB.org.id)
        .send({ title: 'Muss trotz Header in Org A landen' })
        .expect(201);

      const persisted = await prisma.task.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(persisted.organizationId).toBe(orgA.org.id);
      expect(persisted.organizationId).not.toBe(orgB.org.id);
    });

    it('lehnt ein manipuliertes JWT ab', async () => {
      const { org, email, password } = await bootstrapOrgWithUser();
      const token = await loginOrFail(email, password, org.slug);
      const tampered = `${token.slice(0, -2)}xx`;

      await request(httpServer).get('/tasks').set(bearer(tampered)).expect(401);
    });

    it('lehnt ein abgelaufenes JWT ab', async () => {
      const { org, user } = await bootstrapOrgWithUser();
      const expiredToken = await jwtService.signAsync(
        { sub: user.id, org_id: org.id, role: user.role, token_version: user.tokenVersion },
        { expiresIn: '-10s' },
      );

      await request(httpServer).get('/tasks').set(bearer(expiredToken)).expect(401);
    });

    it('lehnt ein zuvor gültiges Token ab, sobald die Organization nachträglich SUSPENDED wird', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      // Token ist zu diesem Zeitpunkt noch gültig.
      await request(httpServer).get('/tasks').set(bearer(token)).expect(200);

      await prisma.organization.update({ where: { id: org.id }, data: { status: 'SUSPENDED' } });

      // Signatur ist weiterhin gültig, die Tenant-Sicherheitsprüfung in
      // JwtStrategy.validate() muss den Zugriff dennoch verweigern.
      await request(httpServer).get('/tasks').set(bearer(token)).expect(401);
    });

    // --- Sprint 2.1: Token Versioning --------------------------------
    it('lehnt ein JWT ohne token_version-Claim ab (älteres Token-Format)', async () => {
      const { org, user } = await bootstrapOrgWithUser();
      // Bewusst ohne token_version signiert, um ein Token im "alten"
      // Format (vor Sprint 2.1) zu simulieren.
      const legacyToken = await jwtService.signAsync({ sub: user.id, org_id: org.id, role: user.role });

      await request(httpServer).get('/tasks').set(bearer(legacyToken)).expect(401);
    });

    it('lehnt ein JWT mit falschem token_version-Claim ab', async () => {
      const { org, user } = await bootstrapOrgWithUser();
      const wrongVersionToken = await jwtService.signAsync({
        sub: user.id,
        org_id: org.id,
        role: user.role,
        token_version: user.tokenVersion + 1,
      });

      await request(httpServer).get('/tasks').set(bearer(wrongVersionToken)).expect(401);
    });

    it('entwertet ein zuvor gültiges Token, sobald tokenVersion erhöht wird (z. B. nach Passwort-Änderung)', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      // Token ist zu diesem Zeitpunkt noch gültig.
      await request(httpServer).get('/tasks').set(bearer(token)).expect(200);

      await prisma.user.updateMany({
        where: { organizationId: org.id, email },
        data: { tokenVersion: { increment: 1 } },
      });

      // Signatur und Ablauf sind weiterhin gültig; die tokenVersion-Prüfung
      // in JwtStrategy.validate() muss den Zugriff dennoch verweigern.
      await request(httpServer).get('/tasks').set(bearer(token)).expect(401);
    });
  });

  // ========================================================================
  // 3b. Login Rate Limiting (Sprint 2.1) — eigene App-Instanz, damit
  //     dieser Test die geteilte Login-Rate-Limit-Zählung der übrigen
  //     Login-Tests nicht verfälscht (ThrottlerStorage ist In-Memory pro
  //     Nest-Anwendung).
  // ========================================================================
  describe('Login Rate Limiting', () => {
    it('liefert 429, sobald das Login-Rate-Limit überschritten wird', async () => {
      const rateLimitApp = await createApp();
      await rateLimitApp.init();
      const rateLimitServer = rateLimitApp.getHttpServer();

      try {
        const maxAttempts = process.env.LOGIN_RATE_LIMIT_MAX
          ? parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10)
          : 5;

        const attempts = [];
        for (let i = 0; i < maxAttempts; i += 1) {
          attempts.push(
            request(rateLimitServer)
              .post('/auth/login')
              .send({ email: 'nobody@example.com', password: 'wrong', organizationSlug: 'no-such-org' }),
          );
        }
        const results = await Promise.all(attempts);
        // Alle Versuche innerhalb des Limits sollten regulär mit 401
        // (falsche Zugangsdaten) durchlaufen, NICHT mit 429.
        for (const res of results) {
          expect(res.status).toBe(401);
        }

        // Der Versuch über dem Limit hinaus muss 429 liefern.
        const overLimit = await request(rateLimitServer)
          .post('/auth/login')
          .send({ email: 'nobody@example.com', password: 'wrong', organizationSlug: 'no-such-org' });
        expect(overLimit.status).toBe(429);
      } finally {
        await rateLimitApp.close();
      }
    });

    it('drosselt keinen anderen Endpunkt (z. B. GET /health bleibt ungedrosselt)', async () => {
      for (let i = 0; i < 10; i += 1) {
        await request(httpServer).get('/health').expect(200);
      }
    });
  });

  // ========================================================================
  // 4. Autorisierung (RBAC)
  // ========================================================================
  describe('Rollenbasierte Autorisierung', () => {
    it('VIEWER kann keine schreibende Task-Operation durchführen', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'VIEWER' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Sollte verboten sein' })
        .expect(403);
    });

    it('VIEWER darf weiterhin lesen (GET /tasks)', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'VIEWER' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer).get('/tasks').set(bearer(token)).expect(200);
    });

    it('ADMIN kann eine erlaubte Verwaltungsoperation durchführen (DigitalEmployee anlegen)', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'ADMIN' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0' })
        .expect(201);
    });

    it('MEMBER kann DigitalEmployees NICHT anlegen (nur OWNER/ADMIN)', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'MEMBER' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0' })
        .expect(403);
    });

    it('MEMBER kann Tasks lesen und bearbeiten', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'MEMBER' });
      const token = await loginOrFail(email, password, org.slug);

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Von MEMBER erstellt' })
        .expect(201);

      await request(httpServer)
        .patch(`/tasks/${task.body.id}`)
        .set(bearer(token))
        .send({ priority: 'HIGH' })
        .expect(200);
    });

    it('nur OWNER/ADMIN dürfen AuditEvents lesen — MEMBER erhält 403', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'MEMBER' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer).get('/audit-events').set(bearer(token)).expect(403);
    });

    it('OWNER darf AuditEvents lesen', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      await request(httpServer).get('/audit-events').set(bearer(token)).expect(200);
    });
  });

  // ========================================================================
  // 5. Development-Fallback: X-Organization-Id (ALLOW_INSECURE_TENANT_HEADER)
  // ========================================================================
  describe('Insecure-Header-Fallback (nur wenn ALLOW_INSECURE_TENANT_HEADER=true)', () => {
    it('ohne gesetztes Flag wird der Header ohne Token weiterhin mit 401 abgelehnt', async () => {
      const { org } = await bootstrapOrgWithUser();
      // Kein Authorization-Header, ALLOW_INSECURE_TENANT_HEADER ist in
      // diesem Testlauf auf 'false' gesetzt (siehe Kopf der Datei).
      await request(httpServer).get('/tasks').set('X-Organization-Id', org.id).expect(401);
    });
  });

  // ========================================================================
  // 6. Fachliche Funktionalität (aus Sprint 1, jetzt mit Auth statt Header)
  // ========================================================================
  describe('Fachliche Funktionalität', () => {
    it('POST /organizations existiert seit Sprint 2.1 nicht mehr (404, auch authentifiziert)', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const suffix = randomUUID().slice(0, 8);
      await request(httpServer)
        .post('/organizations')
        .set(bearer(token))
        .send({ name: `Neue Org ${suffix}`, slug: `neue-org-${suffix}` })
        .expect(404);

      // Auch ganz ohne Token liefert der entfernte Endpunkt weiterhin 404,
      // nicht 401 — er existiert schlicht nicht mehr.
      await request(httpServer)
        .post('/organizations')
        .send({ name: `Neue Org ${suffix}`, slug: `neue-org-${suffix}` })
        .expect(404);
    });

    it('POST /digital-employees erstellt einen DigitalEmployee und ein AuditEvent', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const res = await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0' })
        .expect(201);

      expect(res.body.code).toBe('timo');
      const events = await prisma.auditEvent.findMany({
        where: { organizationId: org.id, entityId: res.body.id },
      });
      expect(events.some((e: { action: string }) => e.action === 'DIGITAL_EMPLOYEE_CREATED')).toBe(true);
    });

    it('POST /tasks weist eine Task einem DigitalEmployee (TIMO) zu', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const timo = await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0' })
        .expect(201);

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Lead prüfen', assignedDigitalEmployeeId: timo.body.id })
        .expect(201);

      expect(task.body.assignedDigitalEmployeeId).toBe(timo.body.id);
    });

    it('POST /tasks/:id/complete markiert eine Task als abgeschlossen', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Abzuschließende Aufgabe' })
        .expect(201);

      const completed = await request(httpServer)
        .post(`/tasks/${task.body.id}/complete`)
        .set(bearer(token))
        .expect(200);

      expect(completed.body.status).toBe('COMPLETED');
      const events = await prisma.auditEvent.findMany({
        where: { organizationId: org.id, entityId: task.body.id, action: 'TASK_COMPLETED' },
      });
      expect(events.length).toBe(1);
    });

    it('vergibt und entzieht eine Capability an einen DigitalEmployee', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const timo = await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0' })
        .expect(201);

      const capability = await request(httpServer)
        .post('/capabilities')
        .set(bearer(token))
        .send({ code: 'lead.read', name: 'Lead lesen' })
        .expect(201);

      await request(httpServer)
        .post(`/digital-employees/${timo.body.id}/capabilities/${capability.body.id}`)
        .set(bearer(token))
        .send({})
        .expect(201);

      const grantEvents = await prisma.auditEvent.findMany({
        where: { organizationId: org.id, action: 'CAPABILITY_GRANTED' },
      });
      expect(grantEvents.length).toBe(1);

      await request(httpServer)
        .delete(`/digital-employees/${timo.body.id}/capabilities/${capability.body.id}`)
        .set(bearer(token))
        .expect(200);

      const revokeEvents = await prisma.auditEvent.findMany({
        where: { organizationId: org.id, action: 'CAPABILITY_REVOKED' },
      });
      expect(revokeEvents.length).toBe(1);
    });

    it('lehnt unbekannte DTO-Felder mit 400 ab (forbidNonWhitelisted)', async () => {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const res = await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0', notAllowed: 'x' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.path).toBe('/digital-employees');
      const message = Array.isArray(res.body.message) ? res.body.message.join(' | ') : res.body.message;
      expect(message).toEqual(expect.stringContaining('notAllowed'));
    });
  });

  // ========================================================================
  // 7. Task-Assignment-Invariante (unverändert aus vorherigem Review)
  // ========================================================================
  describe('Task-Assignment-Invariante (User XOR DigitalEmployee)', () => {
    async function setupOrgWithUserAndTimo() {
      const { org, email, password } = await bootstrapOrgWithUser({ role: 'OWNER' });
      const token = await loginOrFail(email, password, org.slug);

      const assignee = await prisma.user.create({
        data: {
          organizationId: org.id,
          email: `assignee-${randomUUID().slice(0, 8)}@example.com`,
          firstName: 'A',
          lastName: 'Signee',
          role: 'MEMBER',
          status: 'ACTIVE',
        },
      });

      const timo = await request(httpServer)
        .post('/digital-employees')
        .set(bearer(token))
        .send({ name: 'TIMO', code: 'timo', employeeType: 'ORCHESTRATOR', version: '0.1.0' })
        .expect(201);

      return { org, token, user: assignee, timo: timo.body };
    }

    it('wechselt eine Task von User- auf DigitalEmployee-Zuweisung und löscht assignedUserId automatisch', async () => {
      const { token, user, timo } = await setupOrgWithUserAndTimo();

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Wechsel User -> DigitalEmployee', assignedUserId: user.id })
        .expect(201);
      expect(task.body.assignedUserId).toBe(user.id);
      expect(task.body.assignedDigitalEmployeeId).toBeNull();

      const updated = await request(httpServer)
        .patch(`/tasks/${task.body.id}`)
        .set(bearer(token))
        .send({ assignedDigitalEmployeeId: timo.id })
        .expect(200);

      expect(updated.body.assignedDigitalEmployeeId).toBe(timo.id);
      expect(updated.body.assignedUserId).toBeNull();
    });

    it('wechselt eine Task von DigitalEmployee- auf User-Zuweisung und löscht assignedDigitalEmployeeId automatisch', async () => {
      const { token, user, timo } = await setupOrgWithUserAndTimo();

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Wechsel DigitalEmployee -> User', assignedDigitalEmployeeId: timo.id })
        .expect(201);
      expect(task.body.assignedDigitalEmployeeId).toBe(timo.id);
      expect(task.body.assignedUserId).toBeNull();

      const updated = await request(httpServer)
        .patch(`/tasks/${task.body.id}`)
        .set(bearer(token))
        .send({ assignedUserId: user.id })
        .expect(200);

      expect(updated.body.assignedUserId).toBe(user.id);
      expect(updated.body.assignedDigitalEmployeeId).toBeNull();
    });

    it('lehnt den gleichzeitigen Doppelzustand (User UND DigitalEmployee) im selben PATCH mit 400 ab', async () => {
      const { token, user, timo } = await setupOrgWithUserAndTimo();

      const task = await request(httpServer)
        .post('/tasks')
        .set(bearer(token))
        .send({ title: 'Ohne initiale Zuweisung' })
        .expect(201);

      const res = await request(httpServer)
        .patch(`/tasks/${task.body.id}`)
        .set(bearer(token))
        .send({ assignedUserId: user.id, assignedDigitalEmployeeId: timo.id })
        .expect(400);
      expect(res.body.statusCode).toBe(400);

      const unchanged = await request(httpServer).get(`/tasks/${task.body.id}`).set(bearer(token)).expect(200);
      expect(unchanged.body.assignedUserId).toBeNull();
      expect(unchanged.body.assignedDigitalEmployeeId).toBeNull();
    });
  });

  // ========================================================================
  // Sprint 3A — User Administration
  // ========================================================================
  describe('Sprint 3A — User Administration', () => {
    async function createExtraUser(
      org: { id: string; slug: string },
      opts: { role?: Role; status?: UserStatus; password?: string } = {},
    ) {
      const password = opts.password ?? DEFAULT_PASSWORD;
      const passwordHash = await bcrypt.hash(password, TEST_BCRYPT_COST);
      const email = `member-${randomUUID().slice(0, 8)}@example.com`;
      const user = await prisma.user.create({
        data: {
          organizationId: org.id,
          email,
          firstName: 'Extra',
          lastName: 'User',
          role: opts.role ?? 'MEMBER',
          status: opts.status ?? 'ACTIVE',
          passwordHash,
        },
      });
      return { user, email, password };
    }

    describe('GET /users — Pagination, Filter, Soft-Delete-Sichtbarkeit', () => {
      it('unterstützt take/skip (Offset-Pagination) und liefert niemals passwordHash', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);

        for (let i = 0; i < 5; i += 1) {
          await createExtraUser(owner.org);
        }

        const page1 = await request(httpServer)
          .get('/users?take=2&skip=0')
          .set(bearer(token))
          .expect(200);
        expect(page1.body.items).toHaveLength(2);
        expect(page1.body.total).toBeGreaterThanOrEqual(6); // Owner + 5 Extra
        expect(page1.body.take).toBe(2);
        expect(page1.body.skip).toBe(0);
        for (const u of page1.body.items) {
          expect(u.passwordHash).toBeUndefined();
        }

        const page2 = await request(httpServer)
          .get('/users?take=2&skip=2')
          .set(bearer(token))
          .expect(200);
        expect(page2.body.items).toHaveLength(2);
        expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
      });

      it('weist eine sichere Maximalgrenze für take zurück', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);

        await request(httpServer).get('/users?take=1000').set(bearer(token)).expect(400);
      });

      it('filtert nach status und role', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        await createExtraUser(owner.org, { role: 'VIEWER' });
        await createExtraUser(owner.org, { role: 'MEMBER' });

        const viewers = await request(httpServer)
          .get('/users?role=VIEWER')
          .set(bearer(token))
          .expect(200);
        expect(viewers.body.items.every((u: any) => u.role === 'VIEWER')).toBe(true);

        const active = await request(httpServer)
          .get('/users?status=ACTIVE')
          .set(bearer(token))
          .expect(200);
        expect(active.body.items.every((u: any) => u.status === 'ACTIVE')).toBe(true);
      });

      it('blendet DISABLED-User standardmäßig aus und zeigt sie mit includeDisabled=true', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user: toDisable } = await createExtraUser(owner.org);

        await request(httpServer).delete(`/users/${toDisable.id}`).set(bearer(token)).expect(200);

        const defaultList = await request(httpServer).get('/users').set(bearer(token)).expect(200);
        expect(defaultList.body.items.some((u: any) => u.id === toDisable.id)).toBe(false);

        const withDisabled = await request(httpServer)
          .get('/users?includeDisabled=true')
          .set(bearer(token))
          .expect(200);
        expect(withDisabled.body.items.some((u: any) => u.id === toDisable.id)).toBe(true);
      });

      it('nur Users der eigenen Organization werden gelistet', async () => {
        const orgA = await bootstrapOrgWithUser({ role: 'OWNER' });
        const orgB = await bootstrapOrgWithUser({ role: 'OWNER' });
        const tokenA = await loginOrFail(orgA.email, orgA.password, orgA.org.slug);

        const list = await request(httpServer).get('/users').set(bearer(tokenA)).expect(200);
        expect(list.body.items.every((u: any) => u.organizationId === orgA.org.id)).toBe(true);
        expect(list.body.items.some((u: any) => u.id === orgB.user.id)).toBe(false);
      });
    });

    describe('PATCH /users/:id — RBAC und Cross-Tenant', () => {
      it('OWNER darf einen User bearbeiten', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user } = await createExtraUser(owner.org);

        const res = await request(httpServer)
          .patch(`/users/${user.id}`)
          .set(bearer(token))
          .send({ firstName: 'Geändert' })
          .expect(200);
        expect(res.body.firstName).toBe('Geändert');
      });

      it('ADMIN darf normale Rollen verwalten', async () => {
        const admin = await bootstrapOrgWithUser({ role: 'ADMIN' });
        const token = await loginOrFail(admin.email, admin.password, admin.org.slug);
        const { user } = await createExtraUser(admin.org, { role: 'VIEWER' });

        const res = await request(httpServer)
          .patch(`/users/${user.id}`)
          .set(bearer(token))
          .send({ role: 'MEMBER' })
          .expect(200);
        expect(res.body.role).toBe('MEMBER');
      });

      it('ADMIN darf die OWNER-Rolle weder vergeben noch entziehen', async () => {
        const admin = await bootstrapOrgWithUser({ role: 'ADMIN' });
        const token = await loginOrFail(admin.email, admin.password, admin.org.slug);
        const { user: member } = await createExtraUser(admin.org, { role: 'MEMBER' });
        const { user: secondOwner } = await createExtraUser(admin.org, { role: 'OWNER' });

        await request(httpServer)
          .patch(`/users/${member.id}`)
          .set(bearer(token))
          .send({ role: 'OWNER' })
          .expect(403);

        await request(httpServer)
          .patch(`/users/${secondOwner.id}`)
          .set(bearer(token))
          .send({ role: 'MEMBER' })
          .expect(403);
      });

      it('MEMBER und VIEWER dürfen keine User verwalten', async () => {
        const member = await bootstrapOrgWithUser({ role: 'MEMBER' });
        const memberToken = await loginOrFail(member.email, member.password, member.org.slug);
        const { user: target1 } = await createExtraUser(member.org);
        await request(httpServer)
          .patch(`/users/${target1.id}`)
          .set(bearer(memberToken))
          .send({ firstName: 'X' })
          .expect(403);

        const viewer = await bootstrapOrgWithUser({ role: 'VIEWER' });
        const viewerToken = await loginOrFail(viewer.email, viewer.password, viewer.org.slug);
        const { user: target2 } = await createExtraUser(viewer.org);
        await request(httpServer)
          .patch(`/users/${target2.id}`)
          .set(bearer(viewerToken))
          .send({ firstName: 'X' })
          .expect(403);
      });

      it('Cross-Tenant PATCH liefert 404', async () => {
        const orgA = await bootstrapOrgWithUser({ role: 'OWNER' });
        const orgB = await bootstrapOrgWithUser({ role: 'OWNER' });
        const tokenA = await loginOrFail(orgA.email, orgA.password, orgA.org.slug);

        await request(httpServer)
          .patch(`/users/${orgB.user.id}`)
          .set(bearer(tokenA))
          .send({ firstName: 'X' })
          .expect(404);
      });

      it('Rollenwechsel erhöht tokenVersion (altes Token danach ungültig)', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const ownerToken = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user, email, password } = await createExtraUser(owner.org, { role: 'MEMBER' });
        const userToken = await loginOrFail(email, password, owner.org.slug);

        await request(httpServer).get('/tasks').set(bearer(userToken)).expect(200);

        await request(httpServer)
          .patch(`/users/${user.id}`)
          .set(bearer(ownerToken))
          .send({ role: 'ADMIN' })
          .expect(200);

        await request(httpServer).get('/tasks').set(bearer(userToken)).expect(401);
      });

      it('Suspendierung erhöht tokenVersion (altes Token danach ungültig)', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const ownerToken = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user, email, password } = await createExtraUser(owner.org, { role: 'MEMBER' });
        const userToken = await loginOrFail(email, password, owner.org.slug);

        await request(httpServer)
          .patch(`/users/${user.id}`)
          .set(bearer(ownerToken))
          .send({ status: 'SUSPENDED' })
          .expect(200);

        await request(httpServer).get('/tasks').set(bearer(userToken)).expect(401);
      });

      it('lehnt einen ungültigen 3A-Statuswert (z. B. DISABLED) über PATCH ab', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user } = await createExtraUser(owner.org);

        await request(httpServer)
          .patch(`/users/${user.id}`)
          .set(bearer(token))
          .send({ status: 'DISABLED' })
          .expect(400);
      });
    });

    describe('DELETE /users/:id — Soft Delete', () => {
      it('führt kein physisches SQL-DELETE aus, sondern Soft Delete mit deletedByUserId', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user } = await createExtraUser(owner.org);

        const res = await request(httpServer).delete(`/users/${user.id}`).set(bearer(token)).expect(200);
        expect(res.body.status).toBe('DISABLED');
        expect(res.body.deletedAt).not.toBeNull();
        expect(res.body.deletedByUserId).toBe(owner.user.id);

        // Zeile existiert weiterhin (kein physisches Löschen).
        const stillExists = await prisma.user.findUnique({ where: { id: user.id } });
        expect(stillExists).not.toBeNull();
        expect(stillExists?.status).toBe('DISABLED');
      });

      it('lehnt Selbst-Deaktivierung ab', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);

        await request(httpServer).delete(`/users/${owner.user.id}`).set(bearer(token)).expect(403);
      });

      it('Cross-Tenant DELETE liefert 404', async () => {
        const orgA = await bootstrapOrgWithUser({ role: 'OWNER' });
        const orgB = await bootstrapOrgWithUser({ role: 'OWNER' });
        const tokenA = await loginOrFail(orgA.email, orgA.password, orgA.org.slug);

        await request(httpServer).delete(`/users/${orgB.user.id}`).set(bearer(tokenA)).expect(404);
      });

      it('erzeugt USER_DISABLED im Audit-Log', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        const { user } = await createExtraUser(owner.org);

        await request(httpServer).delete(`/users/${user.id}`).set(bearer(token)).expect(200);

        const events = await prisma.auditEvent.findMany({
          where: { organizationId: owner.org.id, entityId: user.id, action: 'USER_DISABLED' },
        });
        expect(events.length).toBe(1);
      });
    });

    describe('Letzter-OWNER-Invariante', () => {
      it('lehnt Degradierung des letzten aktiven OWNER ab (409)', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);

        const res = await request(httpServer)
          .patch(`/users/${owner.user.id}`)
          .set(bearer(token))
          .send({ role: 'ADMIN' })
          .expect(409);
        expect(res.body.statusCode).toBe(409);
      });

      it('lehnt Suspendierung des letzten aktiven OWNER ab (409)', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);

        await request(httpServer)
          .patch(`/users/${owner.user.id}`)
          .set(bearer(token))
          .send({ status: 'SUSPENDED' })
          .expect(409);
      });

      it('lehnt Deaktivierung des letzten aktiven OWNER ab (409)', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const { user: admin, email: adminEmail, password: adminPassword } = await createExtraUser(owner.org, {
          role: 'ADMIN',
        });
        const adminToken = await loginOrFail(adminEmail, adminPassword, owner.org.slug);
        void admin;

        await request(httpServer).delete(`/users/${owner.user.id}`).set(bearer(adminToken)).expect(409);
      });

      it('erlaubt die Aktion, sobald ein zweiter aktiver OWNER existiert', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);
        await createExtraUser(owner.org, { role: 'OWNER' });

        await request(httpServer)
          .patch(`/users/${owner.user.id}`)
          .set(bearer(token))
          .send({ role: 'ADMIN' })
          .expect(200);
      });

      it('Race-Test: zwei parallele Requests gegen zwei unterschiedliche verbleibende OWNER — genau einer erfolgreich, genau einer 409, danach exakt ein aktiver OWNER', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const { user: ownerB } = await createExtraUser(owner.org, { role: 'OWNER' });
        const token = await loginOrFail(owner.email, owner.password, owner.org.slug);

        const [resA, resB] = await Promise.all([
          request(httpServer)
            .patch(`/users/${owner.user.id}`)
            .set(bearer(token))
            .send({ role: 'ADMIN' }),
          request(httpServer)
            .patch(`/users/${ownerB.id}`)
            .set(bearer(token))
            .send({ role: 'ADMIN' }),
        ]);

        const statuses = [resA.status, resB.status].sort();
        expect(statuses).toEqual([200, 409]);

        const remainingOwners = await prisma.user.count({
          where: { organizationId: owner.org.id, role: 'OWNER', status: 'ACTIVE' },
        });
        expect(remainingOwners).toBe(1);
      });
    });

    describe('PATCH /users/me/password', () => {
      it('ändert das Passwort bei korrektem aktuellem Passwort und liefert ein neues, gültiges JWT', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER', password: 'AltesPasswort123!' });
        const oldToken = await loginOrFail(owner.email, 'AltesPasswort123!', owner.org.slug);

        const res = await request(httpServer)
          .patch('/users/me/password')
          .set(bearer(oldToken))
          .send({ currentPassword: 'AltesPasswort123!', newPassword: 'NeuesPasswort456!' })
          .expect(200);

        expect(typeof res.body.accessToken).toBe('string');
        const newToken = res.body.accessToken as string;

        // Neues Token funktioniert.
        await request(httpServer).get('/tasks').set(bearer(newToken)).expect(200);

        // Neues Passwort funktioniert beim Login.
        await loginOrFail(owner.email, 'NeuesPasswort456!', owner.org.slug);
      });

      it('lehnt falsches aktuelles Passwort ab (400)', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER', password: 'AltesPasswort123!' });
        const token = await loginOrFail(owner.email, 'AltesPasswort123!', owner.org.slug);

        await request(httpServer)
          .patch('/users/me/password')
          .set(bearer(token))
          .send({ currentPassword: 'FalschesPasswort!', newPassword: 'NeuesPasswort456!' })
          .expect(400);
      });

      it('entwertet das alte JWT, sobald das Passwort geändert wurde', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER', password: 'AltesPasswort123!' });
        const oldToken = await loginOrFail(owner.email, 'AltesPasswort123!', owner.org.slug);

        await request(httpServer)
          .patch('/users/me/password')
          .set(bearer(oldToken))
          .send({ currentPassword: 'AltesPasswort123!', newPassword: 'NeuesPasswort456!' })
          .expect(200);

        await request(httpServer).get('/tasks').set(bearer(oldToken)).expect(401);
      });

      it('erzeugt USER_PASSWORD_CHANGED im Audit-Log, ohne Passwort/Hash in den Metadaten', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER', password: 'AltesPasswort123!' });
        const token = await loginOrFail(owner.email, 'AltesPasswort123!', owner.org.slug);

        await request(httpServer)
          .patch('/users/me/password')
          .set(bearer(token))
          .send({ currentPassword: 'AltesPasswort123!', newPassword: 'NeuesPasswort456!' })
          .expect(200);

        const events = await prisma.auditEvent.findMany({
          where: { organizationId: owner.org.id, entityId: owner.user.id, action: 'USER_PASSWORD_CHANGED' },
        });
        expect(events.length).toBe(1);
        const metadataString = JSON.stringify(events[0].metadata);
        expect(metadataString).not.toEqual(expect.stringContaining('AltesPasswort123'));
        expect(metadataString).not.toEqual(expect.stringContaining('NeuesPasswort456'));
        expect(metadataString.length).toBeLessThan(10); // erwartet: leeres Objekt "{}"
      });
    });

    describe('E-Mail-Normalisierung', () => {
      it('erlaubt Login unabhängig von Groß-/Kleinschreibung und Leerzeichen der E-Mail', async () => {
        const owner = await bootstrapOrgWithUser({ role: 'OWNER' });
        const mixedCaseEmail = `  ${owner.email.toUpperCase()}  `;

        await loginOrFail(mixedCaseEmail, owner.password, owner.org.slug);
      });
    });
  });
});
