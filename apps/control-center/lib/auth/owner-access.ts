import type { AuthenticatedSession } from './contracts.ts';

/**
 * VITO Control Center interactive owner-only access candidate.
 * Apply ONLY after the existing backend has verified the user's JWT.
 * Never accept ids, roles, or owner flags supplied by browser input.
 */
export type VitoOwnerPolicy = Readonly<{
  ownerUserId?: string;
  ownerOrganizationId?: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isVitoInteractiveOwner(
  session: AuthenticatedSession | null | undefined,
  policy: VitoOwnerPolicy = {
    ownerUserId: process.env.VITO_CONTROL_OWNER_USER_ID,
    ownerOrganizationId: process.env.VITO_CONTROL_OWNER_ORGANIZATION_ID,
  },
): boolean {
  if (!session || !policy || typeof policy !== 'object') return false;
  const ownerUserId = policy.ownerUserId;
  const ownerOrganizationId = policy.ownerOrganizationId;
  // Missing config must never turn into "all organization OWNERs allowed".
  if (!ownerUserId || !UUID.test(ownerUserId) || !ownerOrganizationId || !UUID.test(ownerOrganizationId)) return false;
  const user = session.user;
  const org = session.organization;
  return user?.role === 'OWNER'
    && typeof user.id === 'string'
    && user.id.toLowerCase() === ownerUserId.toLowerCase()
    && typeof user.organizationId === 'string'
    && user.organizationId.toLowerCase() === ownerOrganizationId.toLowerCase()
    && typeof org?.id === 'string'
    && org.id.toLowerCase() === ownerOrganizationId.toLowerCase();
}
