import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { normalizeEmail } from '../../common/utils/normalize-email';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

/**
 * Bcrypt-Hash von irgendeinem festen, nie verwendeten Passwort. Wird für
 * einen "Dummy-Compare" genutzt, wenn Organization/User gar nicht
 * existieren, damit die Antwortzeit von POST /auth/login nicht danach
 * unterscheidbar ist, ob die Organization/E-Mail überhaupt existiert
 * (Abwehr von einfachem User-/Org-Enumeration via Timing).
 */
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Q8y6b1xhvV6MSK3s6zpsFN0BwYUXK';

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    organizationId: string;
  };
}

@Injectable()
export class AuthService {
  private readonly jwtExpiresIn: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN ?? '15m';
  }

  /**
   * Signiert ein JWT für einen bereits geladenen, aktuellen User-Datensatz.
   * Wird sowohl von login() als auch von UsersService (Sprint 3A,
   * PATCH /users/me/password) genutzt, damit es nur eine einzige Stelle
   * gibt, an der Token-Claims zusammengestellt werden.
   */
  async issueTokenFor(user: Pick<User, 'id' | 'organizationId' | 'role' | 'tokenVersion'>): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: string;
  }> {
    const payload: JwtPayload = {
      sub: user.id,
      org_id: user.organizationId,
      role: user.role,
      token_version: user.tokenVersion,
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: this.jwtExpiresIn });

    return { accessToken, tokenType: 'Bearer', expiresIn: this.jwtExpiresIn };
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const organization = await this.prisma.organization.findUnique({
      where: { slug: dto.organizationSlug },
    });

    // Absichtlich generische Fehlermeldung: verrät weder, ob die
    // Organization noch, ob die E-Mail existiert.
    const invalidCredentials = () => new UnauthorizedException('Ungültige Zugangsdaten.');

    if (!organization || organization.status !== 'ACTIVE') {
      // Dummy-Compare, um die Antwortzeit an den Erfolgspfad anzugleichen.
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw invalidCredentials();
    }

    // Sprint 3A: zentrale E-Mail-Normalisierung (trim + lowercase) vor
    // jedem Lookup, siehe common/utils/normalize-email.ts.
    const normalizedEmail = normalizeEmail(dto.email);

    const user = await this.prisma.user.findFirst({
      where: { organizationId: organization.id, email: normalizedEmail },
    });

    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      await bcrypt.compare(dto.password, DUMMY_HASH);
      throw invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const { accessToken, tokenType, expiresIn } = await this.issueTokenFor(user);

    return {
      accessToken,
      tokenType,
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }
}
