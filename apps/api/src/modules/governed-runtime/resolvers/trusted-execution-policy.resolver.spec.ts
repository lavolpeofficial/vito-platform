import { TrustedExecutionPolicyResolver } from './trusted-execution-policy.resolver';
import {
  ExecutionAction,
  ExecutionProfile,
  createBuilderPolicy,
  createReviewerPolicy,
} from '@vito/contracts';

/**
 * Fokussierte B2b-Tests: TrustedExecutionPolicyResolver.
 *
 * KEIN zweiter Policy-Motor: der Resolver delegiert 1:1 an die
 * eingefrorenen EO-01.4-Fabriken (createBuilderPolicy/createReviewerPolicy).
 * Unbekannte Profil-/Capability-Kombinationen fail-closed (null).
 */

const ROOT = '/tmp/governed-workspaces';

const BASE = {
  organizationId: 'org-1',
  workflowRunId: 'run-1',
  workflowStepRunId: 'step-1',
  capabilityCode: 'CODE_BUILD',
  providerId: 'provider-1',
};

describe('TrustedExecutionPolicyResolver', () => {
  it('valid mapping resolves the frozen builder policy rooted at the trusted workspace root', async () => {
    const resolver = new TrustedExecutionPolicyResolver(ROOT);
    const policy = await resolver.resolve({
      ...BASE,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.CREATE_FILE,
    });
    expect(policy).toEqual(createBuilderPolicy(ROOT));
    expect(policy?.policyVersion).toBe('eo-01.4-v1');
    expect(policy?.allowedRoot).toBe(ROOT);
  });

  it('valid mapping resolves the frozen reviewer policy deterministically', async () => {
    const resolver = new TrustedExecutionPolicyResolver(ROOT);
    const policy = await resolver.resolve({
      ...BASE,
      capabilityCode: 'CODE_REVIEW',
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.READ_FILE,
    });
    expect(policy).toEqual(createReviewerPolicy(ROOT));
  });

  it('unknown mapping fails closed: RELEASE_AUTHORITY resolves to null', async () => {
    const resolver = new TrustedExecutionPolicyResolver(ROOT);
    await expect(
      resolver.resolve({
        ...BASE,
        executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
        requestedAction: ExecutionAction.GIT_PUSH,
      }),
    ).resolves.toBeNull();
  });

  it('unknown mapping fails closed: ORCHESTRATOR resolves to null', async () => {
    const resolver = new TrustedExecutionPolicyResolver(ROOT);
    await expect(
      resolver.resolve({
        ...BASE,
        executionProfile: ExecutionProfile.ORCHESTRATOR,
        requestedAction: ExecutionAction.RUN_COMMAND,
      }),
    ).resolves.toBeNull();
  });

  it('adversarial: caller data cannot inject or replace policy — extra context fields are ignored', async () => {
    const resolver = new TrustedExecutionPolicyResolver(ROOT);
    const malicious = {
      ...BASE,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.CREATE_FILE,
      policy: createReviewerPolicy('/attacker-controlled-root'),
      allowedRoot: '/attacker-controlled-root',
      allowAll: true,
    } as Parameters<TrustedExecutionPolicyResolver['resolve']>[0];
    const policy = await resolver.resolve(malicious);
    expect(policy).toEqual(createBuilderPolicy(ROOT));
    expect(policy?.allowedRoot).toBe(ROOT);
  });

  it('policy output remains deterministic across calls (pure factory delegation, versioned)', async () => {
    const resolver = new TrustedExecutionPolicyResolver(ROOT);
    const a = await resolver.resolve({
      ...BASE,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.WRITE_FILE,
    });
    const b = await resolver.resolve({
      ...BASE,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.WRITE_FILE,
    });
    expect(a).toEqual(b);
    expect(a?.policyVersion).toBe(b?.policyVersion);
  });

  it('construction fails closed on a relative workspace root', () => {
    expect(() => new TrustedExecutionPolicyResolver('relative/root')).toThrow(
      /GOVERNED_WORKSPACE_ROOT_INVALID/,
    );
  });
});
