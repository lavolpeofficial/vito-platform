import { TrustedExecutionProfileResolver, DEFAULT_CAPABILITY_PROFILES } from './trusted-execution-profile.resolver';
import { ExecutionProfile } from '@vito/contracts';

/**
 * Fokussierte B2b-Tests: TrustedExecutionProfileResolver.
 *
 * Das effektive ExecutionProfile kommt ausschließlich aus vertrauenswürdiger
 * Server-Konfiguration. Caller-Einfluss ist strukturell ausgeschlossen:
 * der Resolver-Kontext trägt kein Profil-Feld, und fremde Zusatzfelder
 * werden ignoriert.
 */

const TRUSTED = {
  organizationId: 'org-1',
  workflowRunId: 'run-1',
  workflowStepRunId: 'step-1',
  capabilityCode: 'CODE_BUILD',
  providerId: 'provider-1',
};

describe('TrustedExecutionProfileResolver', () => {
  it('known capability resolves to the trusted profile', async () => {
    const resolver = new TrustedExecutionProfileResolver();
    await expect(resolver.resolve(TRUSTED)).resolves.toBe(ExecutionProfile.BUILDER);
  });

  it('unknown capability fails closed (null)', async () => {
    const resolver = new TrustedExecutionProfileResolver();
    await expect(
      resolver.resolve({ ...TRUSTED, capabilityCode: 'TOTALLY_UNKNOWN_CAPABILITY' }),
    ).resolves.toBeNull();
  });

  it('adversarial: caller-injected authority fields in the resolution context are ignored — BUILDER wins over injected RELEASE_AUTHORITY', async () => {
    const resolver = new TrustedExecutionProfileResolver();
    // Simulierter Injection-Versuch: der Kontext wird mit einem nicht-
    // vertragskonformen executionProfile-Feld aufgebläht (Extra-Property).
    const maliciousContext = { ...TRUSTED, executionProfile: 'RELEASE_AUTHORITY' } as typeof TRUSTED & {
      executionProfile?: string;
    };
    await expect(resolver.resolve(maliciousContext)).resolves.toBe(ExecutionProfile.BUILDER);
  });

  it('reviewer-class capability maps to REVIEWER per versioned defaults', async () => {
    const resolver = new TrustedExecutionProfileResolver();
    await expect(
      resolver.resolve({ ...TRUSTED, capabilityCode: 'CODE_REVIEW' }),
    ).resolves.toBe(ExecutionProfile.REVIEWER);
  });

  it('invalid configured profile value is rejected at construction time (fail closed)', () => {
    expect(
      () =>
        new TrustedExecutionProfileResolver({
          CODE_BUILD: 'SUPER_ADMIN' as ExecutionProfile,
        }),
    ).toThrow(/GOVERNED_PROFILE_CONFIG_INVALID/);
  });

  it('empty configuration is rejected at construction time (no silent allow-all)', () => {
    expect(() => new TrustedExecutionProfileResolver({})).toThrow(/GOVERNED_PROFILE_CONFIG_INVALID/);
  });

  it('explicit override configuration replaces the default map deterministically', async () => {
    const resolver = new TrustedExecutionProfileResolver({ CODE_PLAN: ExecutionProfile.REVIEWER });
    await expect(resolver.resolve({ ...TRUSTED, capabilityCode: 'CODE_PLAN' })).resolves.toBe(
      ExecutionProfile.REVIEWER,
    );
    await expect(DEFAULT_CAPABILITY_PROFILES['CODE_BUILD']).toBe(ExecutionProfile.BUILDER);
  });
});
