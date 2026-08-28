/**
 * OB-002A — Governed Sandbox-Environment Contract Drift Guards.
 *
 * The single authoritative sandbox env contract in @vito/contracts. These
 * tests freeze the exact key classification so upstream emission and
 * downstream sandbox acceptance cannot silently disagree:
 *   - A (system-managed), B (process-compatibility), C (governed metadata)
 *   - Caller-permitted = B ∪ C; allowlist = A ∪ B ∪ C.
 * Any intentional addition/removal must be mirrored here AND in the
 * downstream sandbox acceptance tests (sandbox-executor.spec.ts) and the
 * upstream emission test (governed-invocation.service.spec.ts).
 */

import {
  SANDBOX_SYSTEM_MANAGED_ENV,
  SANDBOX_PROCESS_COMPATIBILITY_ENV,
  SANDBOX_GOVERNED_EXECUTION_METADATA_ENV,
  SANDBOX_CALLER_PERMITTED_ENV,
  SANDBOX_ENV_ALLOWLIST,
} from './sandbox-environment.js';

function sortedValues(set: ReadonlySet<string>): readonly string[] {
  return Array.from(set).sort();
}

describe('governed sandbox environment contract', () => {
  describe('exact key classification', () => {
    it('freezes the system-managed class (A) to the executor-owned keys', () => {
      expect(sortedValues(SANDBOX_SYSTEM_MANAGED_ENV)).toEqual([
        'HOME',
        'TMPDIR',
        'XDG_CACHE_HOME',
        'XDG_CONFIG_HOME',
      ]);
    });

    it('freezes the process-compatibility class (B) to the permitted keys', () => {
      expect(sortedValues(SANDBOX_PROCESS_COMPATIBILITY_ENV)).toEqual([
        'LANG',
        'LC_ALL',
        'PATH',
        'USER',
      ]);
    });

    it('freezes the governed execution metadata class (C) to the server-generated keys', () => {
      expect(sortedValues(SANDBOX_GOVERNED_EXECUTION_METADATA_ENV)).toEqual([
        'CAPABILITY_CODE',
        'CORRELATION_ID',
        'EXECUTION_MAX_COST_MINOR_UNITS',
        'EXECUTION_MAX_TOKENS',
        'EXECUTION_TIMEOUT_MS',
        'INVOCATION_ID',
        'ORGANIZATION_ID',
        'PROVIDER_ID',
        'WORKFLOW_RUN_ID',
        'WORKFLOW_STEP_RUN_ID',
      ]);
    });
  });

  describe('union invariants', () => {
    it('classes A, B and C are pairwise disjoint', () => {
      const classes = [
        SANDBOX_SYSTEM_MANAGED_ENV,
        SANDBOX_PROCESS_COMPATIBILITY_ENV,
        SANDBOX_GOVERNED_EXECUTION_METADATA_ENV,
      ];
      for (let i = 0; i < classes.length; i += 1) {
        for (let j = i + 1; j < classes.length; j += 1) {
          const overlap = Array.from(classes[i]).filter((key) => classes[j].has(key));
          expect(overlap).toEqual([]);
        }
      }
    });

    it('caller-permitted is exactly B ∪ C', () => {
      const expected = new Set([
        ...SANDBOX_PROCESS_COMPATIBILITY_ENV,
        ...SANDBOX_GOVERNED_EXECUTION_METADATA_ENV,
      ]);
      expect(sortedValues(SANDBOX_CALLER_PERMITTED_ENV)).toEqual(sortedValues(expected));
      expect(SANDBOX_SYSTEM_MANAGED_ENV.size + SANDBOX_CALLER_PERMITTED_ENV.size).toBe(
        new Set([...SANDBOX_SYSTEM_MANAGED_ENV, ...SANDBOX_CALLER_PERMITTED_ENV]).size,
      );
    });

    it('allowlist is exactly A ∪ caller-permitted', () => {
      const expected = new Set([
        ...SANDBOX_SYSTEM_MANAGED_ENV,
        ...SANDBOX_CALLER_PERMITTED_ENV,
      ]);
      expect(sortedValues(SANDBOX_ENV_ALLOWLIST)).toEqual(sortedValues(expected));
    });
  });

  describe('fail-closed margin', () => {
    it('never permits a caller-supplied override of any system-managed class A key', () => {
      for (const key of SANDBOX_SYSTEM_MANAGED_ENV) {
        expect(SANDBOX_CALLER_PERMITTED_ENV.has(key)).toBe(false);
      }
    });

    it('no governed metadata key carries credentials or secrets', () => {
      // Word-boundary aware: plural budget nouns (EXECUTION_MAX_TOKENS) are
      // metadata, not credential material.
      const credentialPatterns = [
        /\bTOKEN\b/,
        /\bSECRET\b/,
        /\bCREDENTIAL\b/,
        /\bPASSWORD\b/,
        /API[_]?KEY/i,
      ];
      for (const key of SANDBOX_GOVERNED_EXECUTION_METADATA_ENV) {
        const upper = key.toUpperCase();
        for (const pattern of credentialPatterns) {
          expect(pattern.test(upper)).toBe(false);
        }
      }
    });

    it('known dangerous/unknown variables are outside the allowlist', () => {
      for (const key of ['EVIL_TOKEN', 'LD_PRELOAD', 'BASH_ENV', 'ENV', 'SHELL']) {
        expect(SANDBOX_ENV_ALLOWLIST.has(key)).toBe(false);
      }
    });
  });
});