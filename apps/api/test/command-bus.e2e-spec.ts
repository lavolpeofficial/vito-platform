import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-only-command-bus-jwt-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '1h';
process.env.ALLOW_INSECURE_TENANT_HEADER = 'false';
process.env.ENABLE_SWAGGER = 'false';
process.env.OPERATOR_BRIDGE_EXPOSURE = process.env.OPERATOR_BRIDGE_EXPOSURE ?? 'internal';
process.env.SENSITIVE_PAYLOAD_TTL_HOURS = process.env.SENSITIVE_PAYLOAD_TTL_HOURS ?? '72';
process.env.GOVERNED_WORKSPACE_ROOT =
  process.env.GOVERNED_WORKSPACE_ROOT ?? '/tmp/vito-command-bus-e2e-workspaces';

describe('JARVIS Command Bus authorization boundary', () => {
  let app: NestExpressApplication;
  let httpServer: any;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let organizationId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    httpServer = app.getHttpServer();
    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    const suffix = randomUUID().slice(0, 8);
    const org = await prisma.organization.create({
      data: { name: `Command E2E ${suffix}`, slug: `command-e2e-${suffix}`, status: 'ACTIVE' },
    });
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `command-${suffix}@example.com`,
        firstName: 'Command',
        lastName: 'Tester',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    organizationId = org.id;
    userId = user.id;
    token = await jwtService.signAsync({
      sub: user.id,
      org_id: org.id,
      role: user.role,
      token_version: user.tokenVersion,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects command dispatch without authentication', async () => {
    await request(httpServer)
      .post('/commands/dispatch')
      .send({ commandType: 'WORLD.UNKNOWN', parameters: {} })
      .expect(401);
  });

  it('rejects the insecure tenant-header fallback before command execution', async () => {
    process.env.ALLOW_INSECURE_TENANT_HEADER = 'true';
    try {
      await request(httpServer)
        .post('/commands/dispatch')
        .set('X-Organization-Id', organizationId)
        .send({ commandType: 'WORLD.UNKNOWN', parameters: {} })
        .expect(403);
    } finally {
      process.env.ALLOW_INSECURE_TENANT_HEADER = 'false';
    }
  });

  it('rejects client attempts to spoof tenant, actor or approval policy', async () => {
    await request(httpServer)
      .post('/commands/dispatch')
      .set('Authorization', `Bearer ${token}`)
      .send({
        commandType: 'WORLD.UNKNOWN',
        parameters: {},
        organizationId: randomUUID(),
        requestedBy: 'spoofed-actor',
        approvalLevel: 'L0',
      })
      .expect(400);
  });

  it('uses the verified JWT actor for an authenticated rejected command audit', async () => {
    const response = await request(httpServer)
      .post('/commands/dispatch')
      .set('Authorization', `Bearer ${token}`)
      .send({ commandType: 'WORLD.UNKNOWN', parameters: {} })
      .expect(201);

    expect(response.body.status).toBe('REJECTED');
    expect(response.body.reason).toBe('HANDLER_NOT_FOUND');

    const audit = await prisma.auditEvent.findFirst({
      where: {
        organizationId,
        actorId: userId,
        action: 'COMMAND.REJECTED',
        entityId: response.body.commandId,
      },
    });
    expect(audit).not.toBeNull();
  });
});
