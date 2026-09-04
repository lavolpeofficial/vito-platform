import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ScopedMachineIdentityGuard } from '../../common/guards/scoped-machine-identity.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

const LOGIN_RATE_LIMIT_MAX = process.env.LOGIN_RATE_LIMIT_MAX
  ? parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10)
  : 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = process.env.LOGIN_RATE_LIMIT_WINDOW_MS
  ? parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10)
  : 60_000;

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' },
    }),
    // Sprint 2.1: Rate-Limiting ausschließlich für POST /auth/login.
    // Bewusst NICHT global registriert (kein APP_GUARD hier) — der Guard
    // wird stattdessen gezielt nur auf AuthController.login() angewendet
    // (siehe auth.controller.ts), damit keine anderen Endpunkte gedrosselt
    // werden. Default: 5 Requests/Minute pro IP, konfigurierbar über
    // LOGIN_RATE_LIMIT_MAX / LOGIN_RATE_LIMIT_WINDOW_MS.
    ThrottlerModule.forRoot([{ ttl: LOGIN_RATE_LIMIT_WINDOW_MS, limit: LOGIN_RATE_LIMIT_MAX }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // Global registriert: JwtAuthGuard schützt standardmäßig alle
    // Endpunkte außer anonymen @Public()-Requests. Danach erzwingt der
    // ScopedMachineIdentityGuard den globalen Machine-Scope und erst dann
    // prüft RolesGuard bestehende Rollen-Metadaten.
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ScopedMachineIdentityGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  // Sprint 3A: AuthService.issueTokenFor() wird von UsersService
  // (PATCH /users/me/password) wiederverwendet, damit Token-Ausstellung
  // nur an einer Stelle implementiert ist.
  exports: [AuthService],
})
export class AuthModule {}
