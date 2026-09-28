import {
  ExecutionAction,
  ExecutionProfile,
  PolicyReasonCode,
  createBuilderPolicy,
  createReviewerPolicy,
  evaluatePolicy,
  type ExecutionPolicyConfig,
  type PolicyDecision,
} from './execution-policy.js';

const WORKTREE_ROOT = '/workspace/my-project';

function expectDeny(decision: PolicyDecision, expectedCode: PolicyReasonCode): void {
  expect(decision.allowed).toBe(false);
  expect(decision.reasonCode).toBe(expectedCode);
}

function expectAllow(decision: PolicyDecision): void {
  expect(decision.allowed).toBe(true);
  expect(decision.reasonCode).toBe(PolicyReasonCode.POLICY_ALLOWED);
}

describe('PR #143: exact trusted reviewer-agent alias authorization', () => {
  const reviewerAliasPolicy = (): ExecutionPolicyConfig => ({
    ...createReviewerPolicy(WORKTREE_ROOT),
    trustedReviewerAgentAliases: ['opencode'],
  });

  const reviewerDecision = (
    command: string,
    policy: ExecutionPolicyConfig = reviewerAliasPolicy(),
  ): PolicyDecision =>
    evaluatePolicy({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: command,
      policy,
    });

  it('allows the exact server-selected reviewer alias only under REVIEWER', () => {
    expectAllow(reviewerDecision('opencode'));
  });

  it('keeps a bare reviewer policy fail-closed for opencode', () => {
    expectDeny(
      reviewerDecision('opencode', createReviewerPolicy(WORKTREE_ROOT)),
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
    );
  });

  it('does not let reviewer authority bleed into BUILDER', () => {
    expectDeny(
      evaluatePolicy({
        executionProfile: ExecutionProfile.BUILDER,
        requestedAction: ExecutionAction.RUN_COMMAND,
        requestedCommand: 'opencode',
        policy: {
          ...createBuilderPolicy(WORKTREE_ROOT),
          trustedReviewerAgentAliases: ['opencode'],
        },
      }),
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
    );
  });

  it('does not let coding-agent authority bleed into REVIEWER', () => {
    expectDeny(
      reviewerDecision('opencode', {
        ...createReviewerPolicy(WORKTREE_ROOT),
        trustedCodingAgentAliases: ['opencode'],
      }),
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
    );
  });

  it('matches only the exact whole command: no args, prefixes, paths, or chains', () => {
    for (const command of [
      'opencode run',
      'opencode --help',
      './opencode',
      '/usr/bin/opencode',
      'opencode && git status',
      'opencode ; opencode',
      'bash -c opencode',
    ]) {
      expectDeny(reviewerDecision(command), PolicyReasonCode.COMMAND_NOT_ALLOWED);
    }
  });

  it('does not broaden network or git mutation authority', () => {
    const policy = reviewerAliasPolicy();
    expectDeny(
      evaluatePolicy({
        executionProfile: ExecutionProfile.REVIEWER,
        requestedAction: ExecutionAction.NETWORK_ACCESS,
        policy,
      }),
      PolicyReasonCode.NETWORK_ACCESS_DENIED,
    );
    expectDeny(
      reviewerDecision('git commit -m "x"', policy),
      PolicyReasonCode.GIT_COMMIT_DENIED,
    );
    expectDeny(
      reviewerDecision('git push origin main', policy),
      PolicyReasonCode.GIT_PUSH_DENIED,
    );
  });
});
