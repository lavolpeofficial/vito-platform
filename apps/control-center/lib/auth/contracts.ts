export type UserRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type AuthenticatedUser = Readonly<{
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}>;

export type AuthenticatedOrganization = Readonly<{
  id: string;
  name: string;
  slug: string;
}>;

export type AuthenticatedSession = Readonly<{
  user: AuthenticatedUser;
  organization: AuthenticatedOrganization;
}>;

export type LoginCredentials = Readonly<{
  email: string;
  password: string;
  organizationSlug: string;
}>;

export type LoginResult = Readonly<{
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthenticatedUser;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANIZATION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLES = new Set<UserRole>(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

export function parseLoginCredentials(input: unknown): LoginCredentials | null {
  if (!isRecord(input)) return null;
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const organizationSlug = typeof input.organizationSlug === 'string' ? input.organizationSlug.trim() : '';
  if (!email || email.length > 320 || !email.includes('@')) return null;
  if (!password || password.length > 200) return null;
  if (organizationSlug.length < 2 || organizationSlug.length > 60 || !ORGANIZATION_SLUG_PATTERN.test(organizationSlug)) return null;
  return { email, password, organizationSlug };
}

export function parseLoginResult(input: unknown): LoginResult | null {
  if (!isRecord(input) || typeof input.accessToken !== 'string' || input.tokenType !== 'Bearer' || typeof input.expiresIn !== 'string') return null;
  const user = parseUser(input.user);
  if (!user || input.accessToken.length < 20) return null;
  return { accessToken: input.accessToken, tokenType: 'Bearer', expiresIn: input.expiresIn, user };
}

export function parseUser(input: unknown): AuthenticatedUser | null {
  if (!isRecord(input)) return null;
  if (!isUuid(input.id) || !isUuid(input.organizationId)) return null;
  if (typeof input.email !== 'string' || typeof input.firstName !== 'string' || typeof input.lastName !== 'string') return null;
  if (typeof input.role !== 'string' || !ROLES.has(input.role as UserRole)) return null;
  return { id: input.id, organizationId: input.organizationId, email: input.email, firstName: input.firstName, lastName: input.lastName, role: input.role as UserRole };
}

export function parseOrganization(input: unknown): AuthenticatedOrganization | null {
  if (!isRecord(input) || !isUuid(input.id) || typeof input.name !== 'string' || typeof input.slug !== 'string') return null;
  if (input.status !== 'ACTIVE' || !ORGANIZATION_SLUG_PATTERN.test(input.slug)) return null;
  return { id: input.id, name: input.name, slug: input.slug };
}

export function parseJwtIdentifiers(token: string): Readonly<{ userId: string; organizationId: string }> | null {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(payload) || !isUuid(payload.sub) || !isUuid(payload.org_id)) return null;
    return { userId: payload.sub, organizationId: payload.org_id };
  } catch {
    return null;
  }
}

export function parseSessionLifetime(value: string): number | null {
  const match = /^(\d+)(s|m|h)$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = match[2] === 'h' ? 3600 : match[2] === 'm' ? 60 : 1;
  const seconds = amount * multiplier;
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 86_400 ? seconds : null;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isUuid(input: unknown): input is string {
  return typeof input === 'string' && UUID_PATTERN.test(input);
}
