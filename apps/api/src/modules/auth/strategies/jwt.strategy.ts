import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/auth/authenticated-user.interface';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Tenant-Sicherheitsprüfung (Sprint-2-Anforderung 7):
 *
 * Ein gültig signiertes JWT allein reicht NICHT aus. `validate()` läuft
 * bei jedem authentifizierten Request (Passport ruft es erst nach
 * erfolgreicher Signatur-/Ablaufprüfung auf) und lädt User + Organization
 * frisch aus der Datenbank, um zu erzwingen, dass:
 *
 *   - der User im Token tatsächlich noch existiert,
 *   - der User weiterhin zur im Token stehenden Organization gehört
 *     (Verteidigung gegen manipulierte/veraltete org_id-Claims, auch
 *     wenn die Signatur gültig ist),
 *   - der User-Status ACTIVE ist,
 *   - der Organization-Status ACTIVE ist,
 *   - `payload.token_version` exakt `user.tokenVersion` entspricht
 *     (Sprint 2.1, Token Versioning — siehe ADR-003). Ein Token ohne
 *     `token_version` (älteres Format) oder mit abweichendem Wert wird
 *     abgelehnt, auch wenn Signatur und Ablauf gültig sind. Das erlaubt
 *     gezielten Widerruf aller Tokens eines Users (z. B. bei
 *     Passwort-Änderung) durch Erhöhen von `User.tokenVersion`, ganz
 *     ohne Blacklist.
 *
 * Gewählte Strategie & Konsequenzen (siehe auch ADR-003):
 * Diese Prüfung kostet einen zusätzlichen DB-Roundtrip pro
 * authentifiziertem Request. Das ist ein bewusster Trade-off:
 * Ein Token bleibt dadurch NICHT dauerhaft gültig, wenn ein User
 * inzwischen deaktiviert, die Organization suspendiert wurde oder die
 * tokenVersion erhöht wurde — die Sperre wirkt spätestens beim nächsten
 * Request, nicht erst nach Ablauf der (kurzen) Token-Laufzeit. Für das
 * aktuelle Datenvolumen ist der zusätzliche Roundtrip vernachlässigbar;
 * sollte er später relevant werden, kann das Ergebnis kurzlebig (wenige
 * Sekunden) gecacht werden, ohne dieses Modul umzubauen.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET muss gesetzt sein (siehe .env.example).');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { organization: true },
    });

    if (!user) {
      throw new UnauthorizedException('Token nicht mehr gültig.');
    }

    if (user.organizationId !== payload.org_id) {
      // Verteidigungslinie: die im Token stehende Organization muss auch
      // aktuell noch stimmen, selbst wenn die Signatur gültig ist.
      throw new UnauthorizedException('Token nicht mehr gültig.');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Token nicht mehr gültig.');
    }

    if (!user.organization || user.organization.status !== 'ACTIVE') {
      throw new UnauthorizedException('Token nicht mehr gültig.');
    }

    if (payload.token_version !== user.tokenVersion) {
      throw new UnauthorizedException('Token nicht mehr gültig.');
    }

    return {
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      email: user.email,
    };
  }
}
