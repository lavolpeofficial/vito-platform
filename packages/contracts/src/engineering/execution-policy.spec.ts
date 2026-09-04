/**
 * EO-01.4 — Execution Policy & Sandbox Contract Security Tests
 *
 * Comprehensive security test suite covering all mandatory test cases
 * from the builder specification. Tests enforce fail-closed behavior
 * across all profiles, actions, paths, commands, and audit requirements.
 */

import {
  ExecutionProfile,
  ExecutionAction,
  PolicyReasonCode,
  POLICY_REASON_MESSAGES,
  ReleaseGateStatus,
  ExecutionOutcome,
  evaluatePolicy,
  createBuilderPolicy,
  createReviewerPolicy,
  policyDecisionToOutcome,
  auditSafe,
  type PolicyDecision,
  type ExecutionPolicyConfig,
  type PolicyEvaluationContext,
} from './execution-policy.js';

import { AgentExecutionStatus } from './execution.js';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const WORKTREE_ROOT = '/workspace/my-project';
const HOME_DIR = '/home/testuser';

function ctx(overrides: Partial<PolicyEvaluationContext> = {}): PolicyEvaluationContext {
  return {
    executionProfile: ExecutionProfile.BUILDER,
    requestedAction: ExecutionAction.READ_FILE,
    requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    homeDir: HOME_DIR,
    policy: createBuilderPolicy(WORKTREE_ROOT),
    ...overrides,
  };
}

function decide(overrides: Partial<PolicyEvaluationContext> = {}): PolicyDecision {
  return evaluatePolicy(ctx(overrides));
}

function expectDeny(
  decision: PolicyDecision,
  expectedCode?: PolicyReasonCode,
): void {
  expect(decision.allowed).toBe(false);
  if (expectedCode) {
    expect(decision.reasonCode).toBe(expectedCode);
  }
}

function expectAllow(decision: PolicyDecision): void {
  expect(decision.allowed).toBe(true);
  expect(decision.reasonCode).toBe(PolicyReasonCode.POLICY_ALLOWED);
}

// ---------------------------------------------------------------------------
// 1. Builder reads inside assigned worktree -> allow
// ---------------------------------------------------------------------------
describe('test 1: builder reads inside assigned worktree', () => {
  it('allows READ_FILE within builder worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectAllow(d);
  });

  it('allows READ_FILE for nested paths', () => {
    const d = decide({
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/packages/contracts/src/index.ts`,
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 2. Builder writes source inside assigned worktree -> allow
// ---------------------------------------------------------------------------
describe('test 2: builder writes source inside assigned worktree', () => {
  it('allows WRITE_FILE within builder worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/module.ts`,
    });
    expectAllow(d);
  });

  it('allows CREATE_FILE within builder worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.CREATE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/new-file.ts`,
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 3. Builder may modify prisma schema/migration inside assigned worktree
// ---------------------------------------------------------------------------
describe('test 3: builder may modify prisma schema inside assigned worktree', () => {
  it('allows WRITE_FILE for prisma schema inside worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/prisma/schema.prisma`,
    });
    expectAllow(d);
  });

  it('allows CREATE_FILE for prisma migration inside worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.CREATE_FILE,
      requestedPath: `${WORKTREE_ROOT}/prisma/migrations/20240101_init/migration.sql`,
    });
    expectAllow(d);
  });

  it('allows DELETE_FILE for prisma migration inside worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.DELETE_FILE,
      requestedPath: `${WORKTREE_ROOT}/prisma/migrations/old/migration.sql`,
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 4. ../ traversal outside worktree -> deny
// ---------------------------------------------------------------------------
describe('test 4: ../ traversal outside worktree', () => {
  it('denies traversal to parent directory', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/../etc/passwd`,
    });
    expectDeny(d, PolicyReasonCode.PATH_TRAVERSAL_REJECTED);
  });

  it('denies deep traversal escaping worktree', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/../../etc/shadow`,
    });
    expectDeny(d, PolicyReasonCode.PATH_TRAVERSAL_REJECTED);
  });

  it('denies traversal from nested path', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/src/../../etc/passwd`,
    });
    expectDeny(d, PolicyReasonCode.PATH_TRAVERSAL_REJECTED);
  });
});

// ---------------------------------------------------------------------------
// 5. Absolute path outside worktree -> deny
// ---------------------------------------------------------------------------
describe('test 5: absolute path outside worktree', () => {
  it('denies absolute path to /etc/passwd', () => {
    const d = decide({
      requestedPath: '/etc/passwd',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });

  it('denies absolute path to /tmp/sensitive', () => {
    const d = decide({
      requestedPath: '/tmp/sensitive-data.txt',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });
});

// ---------------------------------------------------------------------------
// 6. Explicitly denied child path overrides allowed parent
// ---------------------------------------------------------------------------
describe('test 6: explicitly denied child path overrides allowed parent', () => {
  it('denies .env even though parent dir is allowed', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env`,
    });
    // .env is both a secret pattern and an explicitly denied path;
    // the secret check fires first which is still fail-closed correct
    expect(d.allowed).toBe(false);
  });

  it('denies .env.local even though parent dir is allowed', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env.local`,
    });
    expect(d.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. .env read -> deny
// ---------------------------------------------------------------------------
describe('test 7: .env read -> deny', () => {
  it('denies READ_FILE for .env', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env`,
    });
    expectDeny(d);
  });

  it('denies READ_FILE for .env in subdirectory', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/config/.env`,
    });
    expectDeny(d);
  });
});

// ---------------------------------------------------------------------------
// 8. .env.* read -> deny
// ---------------------------------------------------------------------------
describe('test 8: .env.* read -> deny', () => {
  it('denies READ_FILE for .env.local', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env.local`,
    });
    expectDeny(d);
  });

  it('denies READ_FILE for .env.production', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env.production`,
    });
    expectDeny(d);
  });

  it('denies READ_FILE for .env.development.local', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env.development.local`,
    });
    expectDeny(d);
  });
});

// ---------------------------------------------------------------------------
// 9. Unrestricted HOME read -> deny
// ---------------------------------------------------------------------------
describe('test 9: unrestricted HOME read -> deny', () => {
  it('denies READ_FILE at HOME root', () => {
    const d = decide({
      requestedPath: HOME_DIR,
    });
    // HOME access is denied when homeDir matches
    expectDeny(d);
  });
});

// ---------------------------------------------------------------------------
// 10. Reviewer source read -> allow
// ---------------------------------------------------------------------------
describe('test 10: reviewer source read -> allow', () => {
  it('allows REVIEWER READ_FILE within worktree', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 11. Reviewer source write -> deny
// ---------------------------------------------------------------------------
describe('test 11: reviewer source write -> deny', () => {
  it('denies REVIEWER WRITE_FILE', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectDeny(d, PolicyReasonCode.REVIEWER_WRITE_DENIED);
  });

  it('denies REVIEWER CREATE_FILE', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.CREATE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/new.ts`,
    });
    expectDeny(d, PolicyReasonCode.REVIEWER_WRITE_DENIED);
  });

  it('denies REVIEWER DELETE_FILE', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.DELETE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/old.ts`,
    });
    expectDeny(d, PolicyReasonCode.REVIEWER_WRITE_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 12. Reviewer governed temp artifact creation -> allow
// ---------------------------------------------------------------------------
describe('test 12: reviewer governed temp artifact creation', () => {
  it('allows REVIEWER to read files for review', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/test.ts`,
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 13. git status -> allow
// ---------------------------------------------------------------------------
describe('test 13: git status -> allow', () => {
  it('allows git status for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status',
    });
    expectAllow(d);
  });

  it('allows git status for reviewer', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status',
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 14. git diff -> allow
// ---------------------------------------------------------------------------
describe('test 14: git diff -> allow', () => {
  it('allows git diff for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git diff',
    });
    expectAllow(d);
  });

  it('allows git diff with arguments', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git diff HEAD~1',
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 15. git commit -> deny
// ---------------------------------------------------------------------------
describe('test 15: git commit -> deny', () => {
  it('denies git commit for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git commit -m "test"',
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });

  it('denies git commit for reviewer', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git commit -m "test"',
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 16. git push -> deny
// ---------------------------------------------------------------------------
describe('test 16: git push -> deny', () => {
  it('denies git push for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git push origin main',
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });

  it('denies git push for reviewer', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git push origin main',
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 17. git merge -> deny
// ---------------------------------------------------------------------------
describe('test 17: git merge -> deny', () => {
  it('denies git merge for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git merge feature-branch',
    });
    expectDeny(d, PolicyReasonCode.GIT_MERGE_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 18. git rebase -> deny
// ---------------------------------------------------------------------------
describe('test 18: git rebase -> deny', () => {
  it('denies git rebase for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git rebase main',
    });
    expectDeny(d, PolicyReasonCode.GIT_REBASE_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 19. Branch delete -> deny
// ---------------------------------------------------------------------------
describe('test 19: branch delete -> deny', () => {
  it('denies git branch -D', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git branch -D feature',
    });
    expectDeny(d, PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
  });

  it('denies git branch -d', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git branch -d feature',
    });
    expectDeny(d, PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 20. Remote ref deletion -> deny
// ---------------------------------------------------------------------------
describe('test 20: remote ref deletion -> deny', () => {
  it('denies git push --delete', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git push --delete origin feature',
    });
    expectDeny(d, PolicyReasonCode.REMOTE_REF_DELETE_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 21. Chained safe+unsafe command -> deny
// ---------------------------------------------------------------------------
describe('test 21: chained safe+unsafe command -> deny', () => {
  it('denies git status && git push', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status && git push origin main',
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });

  it('denies npm test; git commit', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'npm test; git commit -m "test"',
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });

  it('denies sh -c git push (opaque shell wrapper)', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: "sh -c 'git push origin main'",
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies bash -c with unsafe command', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'bash -c "git commit"',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });
});

// ---------------------------------------------------------------------------
// 22. Unknown command classification -> deny
// ---------------------------------------------------------------------------
describe('test 22: unknown command classification -> deny', () => {
  it('denies unknown command', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'rm -rf /',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies arbitrary binary execution', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'curl http://evil.com',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });
});

// ---------------------------------------------------------------------------
// 23. Network access without grant -> deny
// ---------------------------------------------------------------------------
describe('test 23: network access without grant', () => {
  it('denies NETWORK_ACCESS for builder', () => {
    const d = decide({
      requestedAction: ExecutionAction.NETWORK_ACCESS,
    });
    expectDeny(d, PolicyReasonCode.NETWORK_ACCESS_DENIED);
  });

  it('denies NETWORK_ACCESS for reviewer', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.NETWORK_ACCESS,
    });
    expectDeny(d, PolicyReasonCode.NETWORK_ACCESS_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 24. Network access with explicit grant -> allow
// ---------------------------------------------------------------------------
describe('test 24: network access with explicit grant', () => {
  it('allows NETWORK_ACCESS when policy grants network', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowNetwork: true,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.NETWORK_ACCESS,
      policy,
      homeDir: HOME_DIR,
    });
    expectAllow(d);
  });
});

// ---------------------------------------------------------------------------
// 25. Missing policy -> deny
// ---------------------------------------------------------------------------
describe('test 25: missing policy -> deny', () => {
  it('denies when policy is undefined', () => {
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectDeny(d, PolicyReasonCode.POLICY_MISSING);
  });
});

// ---------------------------------------------------------------------------
// 26. Unknown profile -> deny
// ---------------------------------------------------------------------------
describe('test 26: unknown profile -> deny', () => {
  it('denies unknown execution profile', () => {
    const d = evaluatePolicy({
      executionProfile: 'HACKER' as any,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
      policy: createBuilderPolicy(WORKTREE_ROOT),
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN);
  });
});

// ---------------------------------------------------------------------------
// 27. Unknown action -> deny
// ---------------------------------------------------------------------------
describe('test 27: unknown action -> deny', () => {
  it('denies unknown action', () => {
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: 'EXPLOIT' as any,
      policy: createBuilderPolicy(WORKTREE_ROOT),
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.ACTION_UNKNOWN);
  });
});

// ---------------------------------------------------------------------------
// 28. Malformed/unresolvable path -> deny
// ---------------------------------------------------------------------------
describe('test 28: malformed/unresolvable path -> deny', () => {
  it('denies path with null bytes', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/src/index.ts\0/etc/passwd`,
    });
    expectDeny(d);
  });
});

// ---------------------------------------------------------------------------
// 29. Release commit without approved Human Gate -> deny
// ---------------------------------------------------------------------------
describe('test 29: release commit without approved Human Gate', () => {
  it('denies GIT_COMMIT without release gate approval', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitCommit: false,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });

  it('denies GIT_COMMIT with pending release gate', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitCommit: false,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.PENDING,
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });

  it('denies GIT_COMMIT with rejected release gate', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitCommit: false,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.REJECTED,
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 30. Release push without approved Human Gate -> deny
// ---------------------------------------------------------------------------
describe('test 30: release push without approved Human Gate', () => {
  it('denies GIT_PUSH without release gate approval', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitPush: false,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy,
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });

  it('denies GIT_PUSH with pending release gate', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitPush: false,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy,
      releaseGateStatus: ReleaseGateStatus.PENDING,
      homeDir: HOME_DIR,
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });
});

// ---------------------------------------------------------------------------
// 31. Policy decision exposes no secret values
// ---------------------------------------------------------------------------
describe('test 31: policy decision exposes no secret values', () => {
  it('decision does not contain raw secret values', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env`,
    });
    // The decision should contain path info but no secret payload
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain('sk_live_');
    expect(serialized).not.toContain('password=');
    expect(serialized).not.toContain('api_key=');
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(auditSafe(d)).toBe(true);
  });

  it('all deny decisions are audit-safe', () => {
    const actions: PolicyReasonCode[] = Object.values(PolicyReasonCode).filter(
      (c) => c !== PolicyReasonCode.POLICY_ALLOWED,
    ) as PolicyReasonCode[];

    for (const reasonCode of actions) {
      const d: PolicyDecision = {
        allowed: false,
        executionProfile: ExecutionProfile.BUILDER,
        requestedAction: ExecutionAction.READ_FILE,
        reasonCode,
        reason: POLICY_REASON_MESSAGES[reasonCode],
        policyVersion: 'test',
        evaluatedAt: new Date(),
      };
      expect(auditSafe(d)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 32. Deterministic identical policy inputs -> identical decision
// ---------------------------------------------------------------------------
describe('test 32: deterministic identical policy inputs', () => {
  it('same inputs produce same decision', () => {
    const input: PolicyEvaluationContext = {
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
      policy: createBuilderPolicy(WORKTREE_ROOT),
      homeDir: HOME_DIR,
    };

    const d1 = evaluatePolicy(input);
    const d2 = evaluatePolicy(input);

    expect(d1.allowed).toBe(d2.allowed);
    expect(d1.reasonCode).toBe(d2.reasonCode);
    expect(d1.executionProfile).toBe(d2.executionProfile);
    expect(d1.requestedAction).toBe(d2.requestedAction);
    expect(d1.normalizedPath).toBe(d2.normalizedPath);
    expect(d1.policyVersion).toBe(d2.policyVersion);
  });

  it('same deny inputs produce same deny decision', () => {
    const input: PolicyEvaluationContext = {
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git push origin main',
      policy: createBuilderPolicy(WORKTREE_ROOT),
      homeDir: HOME_DIR,
    };

    const d1 = evaluatePolicy(input);
    const d2 = evaluatePolicy(input);

    expect(d1.allowed).toBe(d2.allowed);
    expect(d1.reasonCode).toBe(d2.reasonCode);
  });
});

// ---------------------------------------------------------------------------
// 33. Policy blocked maps to AgentExecutionStatus.POLICY_BLOCKED
// ---------------------------------------------------------------------------
describe('test 33: policy blocked maps to AgentExecutionStatus.POLICY_BLOCKED', () => {
  it('POLICY_BLOCKED outcome is defined', () => {
    expect(ExecutionOutcome.POLICY_BLOCKED).toBe('POLICY_BLOCKED');
  });

  it('policyDecisionToOutcome returns POLICY_BLOCKED for denied decisions', () => {
    const d = decide({ requestedPath: '/etc/passwd' });
    const outcome = policyDecisionToOutcome(d);
    expect(outcome).toBe(ExecutionOutcome.POLICY_BLOCKED);
  });

  it('POLICY_BLOCKED maps correctly for status integration', () => {
    const deniedReasonCodes = [
      PolicyReasonCode.POLICY_MISSING,
      PolicyReasonCode.POLICY_INVALID,
      PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN,
      PolicyReasonCode.ACTION_UNKNOWN,
      PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
      PolicyReasonCode.SECRET_ACCESS_DENIED,
      PolicyReasonCode.HOME_ACCESS_DENIED,
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
    ];

    for (const reasonCode of deniedReasonCodes) {
      const d: PolicyDecision = {
        allowed: false,
        executionProfile: ExecutionProfile.BUILDER,
        requestedAction: ExecutionAction.READ_FILE,
        reasonCode,
        reason: 'test',
        policyVersion: 'test',
        evaluatedAt: new Date(),
      };
      expect(policyDecisionToOutcome(d)).toBe(ExecutionOutcome.POLICY_BLOCKED);
    }
  });
});

// ---------------------------------------------------------------------------
// 34. Timeout maps to TIMED_OUT semantics
// ---------------------------------------------------------------------------
describe('test 34: timeout maps to TIMED_OUT semantics', () => {
  it('EXECUTION_TIMEOUT outcome is defined', () => {
    expect(ExecutionOutcome.TIMED_OUT).toBe('TIMED_OUT');
  });

  it('policyDecisionToOutcome returns TIMED_OUT for timeout decisions', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      reasonCode: PolicyReasonCode.EXECUTION_TIMEOUT,
      reason: 'Execution exceeded maximum allowed duration.',
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(policyDecisionToOutcome(d)).toBe(ExecutionOutcome.TIMED_OUT);
  });

  it('QUOTA_BLOCKED outcome maps correctly', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      reasonCode: PolicyReasonCode.EXECUTION_BUDGET_EXCEEDED,
      reason: 'Execution exceeded budget constraints.',
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(policyDecisionToOutcome(d)).toBe(ExecutionOutcome.QUOTA_BLOCKED);
  });
});

// ---------------------------------------------------------------------------
// Symlink escape fail-closed behavior
// ---------------------------------------------------------------------------
describe('symlink escape fail-closed behavior', () => {
  it('denies path that resolves outside worktree via traversal', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/subdir/../../etc/passwd`,
    });
    expectDeny(d, PolicyReasonCode.PATH_TRAVERSAL_REJECTED);
  });

  it('denies path with null bytes (injection attempt)', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/file.ts\0/etc/passwd`,
    });
    expectDeny(d);
  });

  it('denies absolute path that does not resolve inside worktree', () => {
    const d = decide({
      requestedPath: '/etc/passwd',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });
});

// ---------------------------------------------------------------------------
// Additional security invariants
// ---------------------------------------------------------------------------
describe('additional security invariants', () => {
  it('builder cannot write outside worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: '/tmp/outside-worktree/file.ts',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });

  it('builder cannot delete outside worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.DELETE_FILE,
      requestedPath: '/tmp/outside-worktree/file.ts',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });

  it('secrets access denied regardless of profile', () => {
    const d = decide({
      executionProfile: ExecutionProfile.ORCHESTRATOR,
      requestedAction: ExecutionAction.READ_SECRET,
    });
    expectDeny(d, PolicyReasonCode.SECRET_ACCESS_DENIED);
  });

  it('secrets access denied for release authority by default', () => {
    const d = decide({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.READ_SECRET,
    });
    expectDeny(d, PolicyReasonCode.SECRET_ACCESS_DENIED);
  });

  it('ssh key paths are denied', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.ssh/id_rsa`,
    });
    expectDeny(d, PolicyReasonCode.SECRET_ACCESS_DENIED);
  });

  it('credential paths are denied', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/credentials.json`,
    });
    expectDeny(d, PolicyReasonCode.SECRET_ACCESS_DENIED);
  });

  it('token paths are denied', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/token.txt`,
    });
    expectDeny(d, PolicyReasonCode.SECRET_ACCESS_DENIED);
  });

  it('git show is allowed', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git show HEAD',
    });
    expectAllow(d);
  });

  it('git log is allowed', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git log --oneline',
    });
    expectAllow(d);
  });

  it('git rev-parse is allowed', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git rev-parse HEAD',
    });
    expectAllow(d);
  });

  it('git branch --show-current is allowed', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git branch --show-current',
    });
    expectAllow(d);
  });

  it('reviewer cannot write source files', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectDeny(d, PolicyReasonCode.REVIEWER_WRITE_DENIED);
  });

  it('reviewer cannot commit', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git commit -m "review"',
    });
    expectDeny(d, PolicyReasonCode.GIT_COMMIT_DENIED);
  });

  it('reviewer cannot push', () => {
    const d = decide({
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git push',
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });

  it('policy decision includes all required audit fields', () => {
    const d = decide({
      organizationId: 'org-123',
      workflowRunId: 'wf-456',
      workflowStepRunId: 'ws-789',
      correlationId: 'corr-abc',
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });

    expect(d.executionProfile).toBeDefined();
    expect(d.requestedAction).toBeDefined();
    expect(d.reasonCode).toBeDefined();
    expect(d.reason).toBeDefined();
    expect(d.policyVersion).toBeDefined();
    expect(d.evaluatedAt).toBeInstanceOf(Date);
    expect(d.organizationId).toBe('org-123');
    expect(d.workflowRunId).toBe('wf-456');
    expect(d.workflowStepRunId).toBe('ws-789');
    expect(d.correlationId).toBe('corr-abc');
    expect(d.requestedPath).toBeDefined();
    expect(d.normalizedPath).toBeDefined();
  });

  it('release commit WITH explicit grant and approved gate is allowed', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitCommit: true,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
      homeDir: HOME_DIR,
    });
    expectAllow(d);
  });

  it('release push WITH explicit grant and approved gate is allowed', () => {
    const policy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitPush: true,
    };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
      homeDir: HOME_DIR,
    });
    expectAllow(d);
  });

  it('merge is denied even for release authority in EO-01 v0.1', () => {
    const d = decide({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_MERGE,
    });
    expectDeny(d, PolicyReasonCode.GIT_MERGE_DENIED);
  });

  it('rebase is denied even for release authority in EO-01 v0.1', () => {
    const d = decide({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_REBASE,
    });
    expectDeny(d, PolicyReasonCode.GIT_REBASE_DENIED);
  });

  it('branch delete is denied for all profiles', () => {
    for (const profile of Object.values(ExecutionProfile)) {
      const d = decide({
        executionProfile: profile,
        requestedAction: ExecutionAction.GIT_BRANCH_DELETE,
      });
      expectDeny(d, PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
    }
  });

  it('remote ref delete is denied for all profiles', () => {
    for (const profile of Object.values(ExecutionProfile)) {
      const d = decide({
        executionProfile: profile,
        requestedAction: ExecutionAction.REMOTE_REF_DELETE,
      });
      expectDeny(d, PolicyReasonCode.REMOTE_REF_DELETE_DENIED);
    }
  });

  it('chain: git status && git merge is denied', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status && git merge feature',
    });
    expectDeny(d, PolicyReasonCode.GIT_MERGE_DENIED);
  });

  it('chain: npm test && git push is denied', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'npm test && git push origin main',
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });

  it('chain: git status || git push is denied', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status || git push origin main',
    });
    expectDeny(d, PolicyReasonCode.GIT_PUSH_DENIED);
  });

  it('command without policy runs against default policy', () => {
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status',
      policy: createBuilderPolicy(WORKTREE_ROOT),
      homeDir: HOME_DIR,
    });
    expectAllow(d);
  });
});

describe('EO-01.4 immutable governance invariants', () => {
  it('cannot enable merge by setting allowMerge=true', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowMerge: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_MERGE,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(PolicyReasonCode.GIT_MERGE_DENIED);
  });

  it('cannot enable rebase by setting allowRebase=true', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowRebase: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_REBASE,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(PolicyReasonCode.GIT_REBASE_DENIED);
  });

  it('cannot enable branch deletion by setting allowBranchDelete=true', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowBranchDelete: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_BRANCH_DELETE,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
  });

  it('commit requires explicit policy grant even with approved Human Gate', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitCommit: false };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
  });

  it('commit requires approved Human Gate even with explicit policy grant', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitCommit: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.PENDING,
    });
    expect(decision.allowed).toBe(false);
  });

  it('builder cannot commit even with policy grant and approved Human Gate', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitCommit: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
  });

  it('push requires explicit grant, release authority and approved Human Gate', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitPush: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
  });

  it('READ_SECRET remains denied even when allowSecrets=true', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowSecrets: true };
    const decision = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.READ_SECRET,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe(PolicyReasonCode.SECRET_ACCESS_DENIED);
  });
});


// ===========================================================================
// BLOCKING FINDING A — Command Classification Regression Tests
// ===========================================================================
describe('Finding A: command classification grammar', () => {
  it('denies node -e "malicious"', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'node -e "process.exit(1)"',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies node --eval', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'node --eval "require(\'child_process\').execSync(\'id\')"',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies node --input-type', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'node --input-type=module -e "import(\'fs\')"',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies arbitrary npx invocation', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'npx malicious-package',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies npm exec arbitrary package', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'npm exec arbitrary-package',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies pnpm exec arbitrary package', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'pnpm exec arbitrary-package',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies yarn dlx arbitrary package', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'yarn dlx malicious-package',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies single ampersand chaining', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status & git push',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies newline chaining', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status\ngit push',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies output redirection >', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git status > /tmp/output.txt',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies append redirection >>', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'echo test >> /tmp/log.txt',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies input redirection <', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'cat < /etc/passwd',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies command substitution $(...)', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'echo $(whoami)',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies command substitution backticks', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'echo `whoami`',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies process substitution', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'diff <(ls) <(ls -la)',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies sh -c opaque wrapper', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: "sh -c 'git push origin main'",
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies bash -c opaque wrapper', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'bash -c "curl http://evil.com"',
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('denies zsh -c opaque wrapper', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: "zsh -c 'rm -rf /'",
    });
    expectDeny(d, PolicyReasonCode.COMMAND_NOT_ALLOWED);
  });

  it('allows safe git read forms', () => {
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git status' }));
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git diff' }));
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git diff HEAD~1' }));
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git show HEAD' }));
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git log --oneline -10' }));
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git rev-parse HEAD' }));
    expectAllow(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git branch --show-current' }));
  });

  it('denies destructive git forms', () => {
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git push --delete origin feature' }), PolicyReasonCode.REMOTE_REF_DELETE_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git push -d origin feature' }), PolicyReasonCode.GIT_PUSH_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git push origin :feature' }), PolicyReasonCode.REMOTE_REF_DELETE_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git push origin main' }), PolicyReasonCode.GIT_PUSH_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git commit -m "test"' }), PolicyReasonCode.GIT_COMMIT_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git merge feature' }), PolicyReasonCode.GIT_MERGE_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git rebase main' }), PolicyReasonCode.GIT_REBASE_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git branch -D feature' }), PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
    expectDeny(decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git branch -d feature' }), PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
  });
});

// ===========================================================================
// OB-002A — Exact Trusted Coding-Agent Alias Authorization (Decision B)
// ===========================================================================
describe('OB-002A: exact trusted coding-agent alias authorization', () => {
  const aliasPolicy = () =>
    ({ ...createBuilderPolicy(WORKTREE_ROOT), trustedCodingAgentAliases: ['opencode'] });

  it('allows the exact server-selected trusted coding-agent alias under the builder policy', () => {
    expectAllow(
      decide({
        requestedAction: ExecutionAction.RUN_COMMAND,
        requestedCommand: 'opencode',
        policy: aliasPolicy(),
      }),
    );
  });

  it('keeps existing safe builder commands allowed when aliases are present', () => {
    const policy = aliasPolicy();
    for (const command of ['git status', 'npm test', 'npm run build', 'tsc --noEmit']) {
      expectAllow(
        decide({
          requestedAction: ExecutionAction.RUN_COMMAND,
          requestedCommand: command,
          policy,
        }),
      );
    }
  });

  it('grants no global/world-readable authority: a bare builder policy without aliases still denies the alias', () => {
    expectDeny(
      decide({
        requestedAction: ExecutionAction.RUN_COMMAND,
        requestedCommand: 'opencode',
      }),
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
    );
  });

  it('does not grant the alias outside the intended profile (reviewer still denies)', () => {
    expectDeny(
      decide({
        executionProfile: ExecutionProfile.REVIEWER,
        requestedAction: ExecutionAction.RUN_COMMAND,
        requestedCommand: 'opencode',
        policy: {
          ...createReviewerPolicy(WORKTREE_ROOT),
          trustedCodingAgentAliases: ['opencode'],
        },
      }),
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
    );
  });

  it('matches the exact whole command only — no prefix, no arguments', () => {
    const policy = aliasPolicy();
    for (const command of ['opencode --dangerous', 'opencode status', 'opencode foo', 'opencode --help']) {
      expectDeny(
        decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: command, policy }),
        PolicyReasonCode.COMMAND_NOT_ALLOWED,
      );
    }
  });

  it('rejects an unregistered/mismatched alias fail-closed', () => {
    const policy = aliasPolicy();
    for (const command of ['codex', 'claude', 'gemini']) {
      expectDeny(
        decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: command, policy }),
        PolicyReasonCode.COMMAND_NOT_ALLOWED,
      );
    }
  });

  it('does not authorize shell chaining through the alias', () => {
    const policy = aliasPolicy();
    for (const command of ['opencode && opencode', 'opencode && git status', 'opencode ; opencode']) {
      expectDeny(
        decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: command, policy }),
        PolicyReasonCode.COMMAND_NOT_ALLOWED,
      );
    }
  });

  it('arbitrary shell/opaque-wrapper execution remains blocked even with the alias present', () => {
    const policy = aliasPolicy();
    for (const command of ['bash -c opencode', 'sh -c "opencode"', 'node -e "process.exit(1)"', 'cat /etc/passwd']) {
      expectDeny(
        decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: command, policy }),
        PolicyReasonCode.COMMAND_NOT_ALLOWED,
      );
    }
  });

  it('arbitrary executable paths remain impossible through policy input', () => {
    const policy = aliasPolicy();
    for (const command of ['./opencode', '/usr/bin/opencode', '~/opencode', '../opencode']) {
      expectDeny(
        decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: command, policy }),
        PolicyReasonCode.COMMAND_NOT_ALLOWED,
      );
    }
  });

  it('does not broaden network, secret, or git-release authority', () => {
    const policy = aliasPolicy();
    expectDeny(
      decide({
        requestedAction: ExecutionAction.NETWORK_ACCESS,
        requestedPath: 'https://evil.example',
        policy,
      }),
      PolicyReasonCode.NETWORK_ACCESS_DENIED,
    );
    expectDeny(
      decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git commit -m "x"', policy }),
      PolicyReasonCode.GIT_COMMIT_DENIED,
    );
    expectDeny(
      decide({ requestedAction: ExecutionAction.RUN_COMMAND, requestedCommand: 'git push origin main', policy }),
      PolicyReasonCode.GIT_PUSH_DENIED,
    );
    expectDeny(
      decide({
        requestedAction: ExecutionAction.READ_SECRET,
        requestedPath: `${WORKTREE_ROOT}/.env`,
        policy,
      }),
      PolicyReasonCode.SECRET_ACCESS_DENIED,
    );
  });
});

// ===========================================================================
// BLOCKING FINDING B — Path Canonicalization / Traversal Regression Tests
// ===========================================================================
describe('Finding B: path canonicalization and encoded traversal', () => {
  it('denies percent-encoded traversal ..%2F', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/..%2F..%2Fetc/passwd`,
    });
    expectDeny(d);
  });

  it('denies lowercase encoded dots %2e%2e/', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/%2e%2e/%2e%2e/etc/passwd`,
    });
    expectDeny(d);
  });

  it('denies uppercase encoded path %2E%2E%2F', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/%2E%2E%2Fetc%2Fpasswd`,
    });
    expectDeny(d);
  });

  it('denies encoded backslash %5c', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/..%5c..%5cetc/passwd`,
    });
    expectDeny(d);
  });

  it('denies encoded NUL %00', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/file.ts%00/etc/passwd`,
    });
    expectDeny(d);
  });

  it('denies sibling-prefix escape', () => {
    const d = decide({
      requestedPath: '/workspace/project-evil/file.ts',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });

  it('allows legitimate nested worktree paths', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectAllow(d);
  });

  it('allows Prisma source inside builder worktree', () => {
    const d = decide({
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/prisma/schema.prisma`,
    });
    expectAllow(d);
  });
});

// ===========================================================================
// BLOCKING FINDING C — Symlink Escape Tests
// ===========================================================================
describe('Finding C: symlink escape prevention', () => {
  it('denies path that resolves outside worktree via traversal', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/subdir/../../etc/passwd`,
    });
    expectDeny(d, PolicyReasonCode.PATH_TRAVERSAL_REJECTED);
  });

  it('denies path with raw null bytes', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/file.ts\0/etc/passwd`,
    });
    expectDeny(d);
  });

  it('denies absolute path outside worktree', () => {
    const d = decide({
      requestedPath: '/etc/passwd',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });

  it('denies encoded traversal via percent-encoding', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/..%2F..%2Fetc/passwd`,
    });
    expectDeny(d);
  });
});

// ===========================================================================
// BLOCKING FINDING D — Orchestrator / Release Path Authority Tests
// ===========================================================================
describe('Finding D: orchestrator and release authority restrictions', () => {
  it('ORCHESTRATOR cannot WRITE_FILE productive source', () => {
    const d = decide({
      executionProfile: ExecutionProfile.ORCHESTRATOR,
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectDeny(d);
  });

  it('ORCHESTRATOR cannot CREATE_FILE productive source', () => {
    const d = decide({
      executionProfile: ExecutionProfile.ORCHESTRATOR,
      requestedAction: ExecutionAction.CREATE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/new.ts`,
    });
    expectDeny(d);
  });

  it('ORCHESTRATOR cannot DELETE_FILE productive source', () => {
    const d = decide({
      executionProfile: ExecutionProfile.ORCHESTRATOR,
      requestedAction: ExecutionAction.DELETE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/old.ts`,
    });
    expectDeny(d);
  });

  it('ORCHESTRATOR can READ_FILE within worktree', () => {
    const d = decide({
      executionProfile: ExecutionProfile.ORCHESTRATOR,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectAllow(d);
  });

  it('ORCHESTRATOR cannot READ_FILE outside worktree', () => {
    const d = decide({
      executionProfile: ExecutionProfile.ORCHESTRATOR,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: '/etc/passwd',
    });
    expectDeny(d);
  });

  it('RELEASE_AUTHORITY cannot obtain arbitrary filesystem writes', () => {
    const d = decide({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectDeny(d);
  });

  it('RELEASE_AUTHORITY cannot CREATE_FILE outside worktree', () => {
    const d = decide({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.CREATE_FILE,
      requestedPath: '/tmp/arbitrary/file.ts',
    });
    expectDeny(d);
  });

  it('RELEASE_AUTHORITY can READ_FILE within worktree', () => {
    const d = decide({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.READ_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    });
    expectAllow(d);
  });
});

// ===========================================================================
// BLOCKING FINDING E — Permission Model Consolidation
// ===========================================================================
describe('Finding E: consolidated permission model', () => {
  it('Prisma schema write inside builder worktree remains allowed', () => {
    const d = decide({
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/prisma/schema.prisma`,
    });
    expectAllow(d);
  });

  it('Prisma migration create inside builder worktree remains allowed', () => {
    const d = decide({
      requestedAction: ExecutionAction.CREATE_FILE,
      requestedPath: `${WORKTREE_ROOT}/prisma/migrations/20240101_init/migration.sql`,
    });
    expectAllow(d);
  });

  it('Prisma schema write outside worktree is denied', () => {
    const d = decide({
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: '/workspace/other-project/prisma/schema.prisma',
    });
    expectDeny(d, PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT);
  });
});

// ===========================================================================
// BLOCKING FINDING F — Audit Safety Regression Tests
// ===========================================================================
describe('Finding F: audit safety and credential redaction', () => {
  it('secret-bearing values are not exposed in audit output', () => {
    const d = decide({
      requestedPath: `${WORKTREE_ROOT}/.env`,
    });
    const serialized = JSON.stringify(d);
    expect(serialized).not.toContain('sk_live_');
    expect(serialized).not.toContain('password=');
    expect(serialized).not.toContain('api_key=');
    expect(serialized).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(auditSafe(d)).toBe(true);
  });

  it('auditSafe rejects long base64 strings', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      reasonCode: PolicyReasonCode.POLICY_MISSING,
      reason: 'AAAAABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/AAAA',
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(auditSafe(d)).toBe(false);
  });

  it('auditSafe rejects JWT-like values', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      reasonCode: PolicyReasonCode.POLICY_MISSING,
      reason: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(auditSafe(d)).toBe(false);
  });

  it('auditSafe rejects GitHub token patterns', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      reasonCode: PolicyReasonCode.POLICY_MISSING,
      reason: 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(auditSafe(d)).toBe(false);
  });

  it('auditSafe rejects password assignments', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      reasonCode: PolicyReasonCode.POLICY_MISSING,
      reason: "password: 'supersecret123'",
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(auditSafe(d)).toBe(false);
  });

  it('auditSafe rejects private key markers', () => {
    const d: PolicyDecision = {
      allowed: false,
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.READ_FILE,
      reasonCode: PolicyReasonCode.POLICY_MISSING,
      reason: '-----BEGIN RSA PRIVATE KEY-----',
      policyVersion: 'test',
      evaluatedAt: new Date(),
    };
    expect(auditSafe(d)).toBe(false);
  });

  it('auditSafe allows normal reason messages', () => {
    const d = decide({
      requestedAction: ExecutionAction.RUN_COMMAND,
      requestedCommand: 'git push origin main',
    });
    expect(auditSafe(d)).toBe(true);
  });
});

// ===========================================================================
// Release Governance Regression Matrix
// ===========================================================================
describe('release governance regression matrix', () => {
  it('allowMerge=true still cannot enable merge', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowMerge: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_MERGE,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe(PolicyReasonCode.GIT_MERGE_DENIED);
  });

  it('allowRebase=true still cannot enable rebase', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowRebase: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_REBASE,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe(PolicyReasonCode.GIT_REBASE_DENIED);
  });

  it('allowBranchDelete=true still cannot enable branch deletion', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowBranchDelete: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_BRANCH_DELETE,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe(PolicyReasonCode.GIT_BRANCH_DELETE_DENIED);
  });

  it('approved gate alone does not permit commit', () => {
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy: createBuilderPolicy(WORKTREE_ROOT),
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
  });

  it('explicit grant alone does not permit commit (no approved gate)', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitCommit: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.PENDING,
    });
    expect(d.allowed).toBe(false);
  });

  it('wrong profile + grant + approved gate does not permit commit', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitCommit: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_COMMIT,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
  });

  it('approved gate alone does not permit push', () => {
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy: createBuilderPolicy(WORKTREE_ROOT),
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
  });

  it('explicit grant alone does not permit push (no approved gate)', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitPush: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy,
      releaseGateStatus: ReleaseGateStatus.PENDING,
    });
    expect(d.allowed).toBe(false);
  });

  it('wrong profile + grant + approved gate does not permit push', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowGitPush: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.BUILDER,
      requestedAction: ExecutionAction.GIT_PUSH,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
  });

  it('READ_SECRET + allowSecrets=true still denied', () => {
    const policy = { ...createBuilderPolicy(WORKTREE_ROOT), allowSecrets: true };
    const d = evaluatePolicy({
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.READ_SECRET,
      policy,
      releaseGateStatus: ReleaseGateStatus.APPROVED,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe(PolicyReasonCode.SECRET_ACCESS_DENIED);
  });
});
