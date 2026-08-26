import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

const logger = new Logger('Bootstrap');

/**
 * Harte Startup-Sicherheitsprüfung (Sprint-2-Anforderung 4):
 *
 * `ALLOW_INSECURE_TENANT_HEADER=true` darf niemals zusammen mit
 * `NODE_ENV=production` aktiv sein. Die Anwendung startet in diesem Fall
 * gar nicht erst, statt nur eine Warnung zu loggen — ein falsch gesetztes
 * Flag in Produktion würde sonst die gesamte Mandantentrennung aushebeln
 * (siehe ADR-003).
 */
function assertSecureProductionConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const insecureHeaderAllowed = process.env.ALLOW_INSECURE_TENANT_HEADER === 'true';

  if (isProduction && insecureHeaderAllowed) {
    logger.error(
      'Start verweigert: ALLOW_INSECURE_TENANT_HEADER=true ist zusammen mit NODE_ENV=production nicht zulässig. ' +
        'Dieser Development-Fallback würde die JWT-basierte Mandantentrennung in Produktion aushebeln.',
    );
    process.exit(1);
  }

  if (!process.env.JWT_SECRET) {
    // Zusätzlich zur harten Prüfung in JwtStrategy: frühestmögliches,
    // klares Fail-Fast mit verständlicher Meldung.
    logger.error('Start verweigert: JWT_SECRET ist nicht gesetzt (siehe .env.example).');
    process.exit(1);
  }
}

/**
 * Swagger ist gemäß Sprint-2-Vorgabe nur nach einer dokumentierten
 * Entwicklungsregel erreichbar: standardmäßig aktiv, außer in Produktion
 * (`NODE_ENV=production`), es sei denn, es wird explizit über
 * `ENABLE_SWAGGER=true` angefordert (z. B. für eine abgesicherte
 * Staging-Umgebung).
 */
function isSwaggerEnabled(): boolean {
  if (process.env.ENABLE_SWAGGER === 'true') {
    return true;
  }
  return process.env.NODE_ENV !== 'production';
}

/**
 * CORS-Konfiguration (Sprint 2.1): In Produktion NIEMALS `origin: "*"`.
 * Erlaubte Origins kommen ausschließlich aus `CORS_ALLOWED_ORIGINS`
 * (kommagetrennte Liste). Ist die Liste in Produktion leer, werden
 * Cross-Origin-Requests standardmäßig abgelehnt (`origin: false`) statt
 * versehentlich alles zuzulassen — ein fehlendes Environment sollte nicht
 * automatisch zu einer offenen CORS-Policy führen.
 *
 * In Development bleibt das Verhalten unverändert permissiv, damit lokale
 * Frontend-Entwicklung (beliebiger Port) ohne Konfiguration funktioniert.
 */
function buildCorsOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    return { origin: true, credentials: true };
  }

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    logger.warn(
      'CORS_ALLOWED_ORIGINS ist in Produktion nicht gesetzt — Cross-Origin-Requests werden vollständig blockiert. ' +
        'Bitte erlaubte Origins explizit konfigurieren, statt "*" zu verwenden.',
    );
  }

  return { origin: allowedOrigins.length > 0 ? allowedOrigins : false, credentials: true };
}

export async function createApp() {
  assertSecureProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureBodyParsers(app);

  // Sprint 2.1: Security-Header per Helmet (u. a. Content-Security-Policy-
  // Basisschutz, X-Frame-Options, X-Content-Type-Options, HSTS in
  // Produktion). Vor allen anderen Middlewares/Guards angewendet.
  app.use(helmet());

  app.enableCors(buildCorsOptions());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  if (isSwaggerEnabled()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('VITO Digital Workforce Platform API')
      .setDescription(
        'API der VITO Digital Workforce Platform. VITO verwaltet Organisationen, ' +
          'menschliche Benutzer, digitale Mitarbeiter, Fähigkeiten, Aufgaben und Audit-Ereignisse. ' +
          'VITO ist ausdrücklich kein CRM und kein ERP.\n\n' +
          'Authentifizierung: POST /auth/login liefert ein JWT, das als ' +
          '"Authorize" (Bearer Token) in Swagger hinterlegt werden kann.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  } else {
    logger.log('Swagger ist deaktiviert (NODE_ENV=production ohne ENABLE_SWAGGER=true).');
  }

  return app;
}

export function configureBodyParsers(app: NestExpressApplication): void {
  // JSON escaping can expand a valid 512 KiB decoded prompt to roughly 3 MiB.
  app.useBodyParser('json', { limit: 4 * 1024 * 1024 });
  app.useBodyParser('urlencoded', { limit: 4 * 1024 * 1024, extended: true });
}

async function bootstrap() {
  const app = await createApp();
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  logger.log(`VITO API läuft auf http://localhost:${port}`);
  if (isSwaggerEnabled()) {
    logger.log(`Swagger verfügbar unter http://localhost:${port}/api/docs`);
  }
}

if (require.main === module) {
  bootstrap();
}
