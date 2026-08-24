import {
  ExecutionProfile,
  type ExecutionProfileResolutionContext,
  type ExecutionProfileResolver,
} from '@vito/contracts';

/**
 * Versionierte v1-Standardzuordnung capabilityCode -> ExecutionProfile.
 *
 * Dies ist vertrauenswürdige Server-Konfiguration in Codeform (keine
 * datenbank-editierbare Policy, keine Tenant-Eskalation). Nur Profile mit
 * existierenden EO-01.4-Policy-Fabriken sind verdrahtet; freigaberelevante
 * Profile bleiben bewusst ohne produktive Zuordnung.
 */
export const DEFAULT_CAPABILITY_PROFILES: Readonly<Record<string, ExecutionProfile>> =
  Object.freeze({
    CODE_PLAN: ExecutionProfile.BUILDER,
    CODE_BUILD: ExecutionProfile.BUILDER,
    TEST_EXECUTION: ExecutionProfile.BUILDER,
    REVIEW_PACKAGE: ExecutionProfile.REVIEWER,
    CODE_REVIEW: ExecutionProfile.REVIEWER,
    SECURITY_REVIEW: ExecutionProfile.REVIEWER,
  });

const VALID_PROFILES: readonly string[] = [
  ExecutionProfile.BUILDER,
  ExecutionProfile.REVIEWER,
  ExecutionProfile.ORCHESTRATOR,
  ExecutionProfile.RELEASE_AUTHORITY,
];

function validateCapabilityProfileMap(
  map: Readonly<Record<string, ExecutionProfile>>,
): ReadonlyMap<string, ExecutionProfile> {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    throw new Error(
      'GOVERNED_PROFILE_CONFIG_INVALID: empty capability->profile configuration (fail closed)',
    );
  }
  const validated = new Map<string, ExecutionProfile>();
  for (const [capabilityCode, profile] of entries) {
    if (!capabilityCode || typeof capabilityCode !== 'string') {
      throw new Error(`GOVERNED_PROFILE_CONFIG_INVALID: invalid capability code`);
    }
    if (!VALID_PROFILES.includes(profile)) {
      throw new Error(
        `GOVERNED_PROFILE_CONFIG_INVALID: unknown ExecutionProfile for capability ${capabilityCode}`,
      );
    }
    validated.set(capabilityCode, profile);
  }
  return validated;
}

/**
 * Vertrauenswürdiger TrustedExecutionProfileResolver (EO-01.5-Schnittstelle).
 *
 * Das effektive ExecutionProfile kommt ausschließlich aus der injizierten
 * Konfiguration. Der Resolution-Kontext trägt strukturell KEIN Profilfeld
 * und keine Caller-Autorität — ein Injection-Versuch über Zusatzfelder ist
 * wirkungslos. Unbekannte/fehltende Capability fail-closed (null), bevor
 * irgendeine Ausführung autorisiert wird.
 */
export class TrustedExecutionProfileResolver implements ExecutionProfileResolver {
  private readonly mapping: ReadonlyMap<string, ExecutionProfile>;

  constructor(capabilityProfiles: Readonly<Record<string, ExecutionProfile>> = DEFAULT_CAPABILITY_PROFILES) {
    this.mapping = validateCapabilityProfileMap(capabilityProfiles);
  }

  async resolve(context: ExecutionProfileResolutionContext): Promise<ExecutionProfile | null> {
    return this.mapping.get(context.capabilityCode) ?? null;
  }
}
