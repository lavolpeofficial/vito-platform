/**
 * Optional private-human boundary for the VITO execution API.
 *
 * Only turn this on after owner-id and organization-id verification, full
 * CI/E2E, and explicit owner release. It is intentionally disabled by default
 * so this isolated PR cannot alter existing environments when merged.
 *
 * The VITO backend already verifies JWT + fresh User/Organization state.
 * Invoke this policy only with that database-verified user, never with
 * client-supplied JWT claims or headers.
 */
export type PrivateHumanAccessConfig = Readonly<{
  enabled: boolean;
  ownerUserId?: string;
  ownerOrganizationId?: string;
}>;

export type VerifiedVitoPrincipal = Readonly<{
  id: string;
  organizationId: string;
  role: string;
  isMachineIdentity: boolean;
  machineScope: string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function privateHumanAccessConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PrivateHumanAccessConfig {
  return {
    enabled: env.VITO_PRIVATE_HUMAN_API_OWNER_ONLY === 'true',
    ownerUserId: env.VITO_PRIVATE_HUMAN_OWNER_USER_ID,
    ownerOrganizationId: env.VITO_PRIVATE_HUMAN_OWNER_ORGANIZATION_ID,
  };
}

/**
 * Machine principals are not human logins. They must still pass the existing
 * scoped-machine-identity guard on each machine-designated endpoint.
 *
 * Human principals, when enabled, must match one exact local VITO account.
 * No default owner, no email lookup, no organization-only OWNER access.
 */
export function canAccessPrivateVitoApi(
  verified: VerifiedVitoPrincipal | null | undefined,
  config: PrivateHumanAccessConfig,
): boolean {
  if (!verified) return false;
  if (config.enabled !== true) return true;
  if (verified.isMachineIdentity === true) {
    return typeof verified.machineScope === 'string' && verified.machineScope.length > 0;
  }
  if (verified.isMachineIdentity !== false || verified.machineScope !== null) return false;
  const ownerId=config.ownerUserId;
  const organizationId=config.ownerOrganizationId;
  if (typeof ownerId !== 'string' || !UUID.test(ownerId) ||
      typeof organizationId !== 'string' || !UUID.test(organizationId)) return false;
  return verified.role === 'OWNER' &&
    verified.id.toLowerCase() === ownerId.toLowerCase() &&
    verified.organizationId.toLowerCase() === organizationId.toLowerCase();
}

/**
 * Interactive password login is for one human only in private-human mode.
 * Machine tokens keep their separate, existing approved issuance pathway;
 * do not reuse the interactive password login for machine principals.
 */
export function canUsePrivateVitoHumanLogin(
  verified: VerifiedVitoPrincipal | null | undefined,
  config: PrivateHumanAccessConfig,
): boolean {
  if (!verified) return false;
  if (config.enabled !== true) return true;
  return verified.isMachineIdentity === false && canAccessPrivateVitoApi(verified,config);
}
