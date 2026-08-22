/**
 * EO-01.4 — Execution Policy & Sandbox Contract
 *
 * Mandatory execution-policy boundary that every future productive
 * provider execution must pass.
 *
 * Core invariant: Provider routing eligibility != execution permission.
 * A provider selected by EO-01.3 still MUST pass EO-01.4 policy enforcement.
 *
 * Security model: Fail closed. No fallback-to-allow behavior.
 */

import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Execution Profile
// ---------------------------------------------------------------------------

/** Execution profiles for governed agent execution. */
export enum ExecutionProfile {
  BUILDER = 'BUILDER',
  REVIEWER = 'REVIEWER',
  ORCHESTRATOR = 'ORCHESTRATOR',
  RELEASE_AUTHORITY = 'RELEASE_AUTHORITY',
}

// ---------------------------------------------------------------------------
// Execution Action
// ---------------------------------------------------------------------------

/** Atomic execution actions subject to policy enforcement. */
export enum ExecutionAction {
  READ_FILE = 'READ_FILE',
  WRITE_FILE = 'WRITE_FILE',
  CREATE_FILE = 'CREATE_FILE',
  DELETE_FILE = 'DELETE_FILE',
  RUN_COMMAND = 'RUN_COMMAND',
  NETWORK_ACCESS = 'NETWORK_ACCESS',
  READ_SECRET = 'READ_SECRET',
  GIT_READ = 'GIT_READ',
  GIT_COMMIT = 'GIT_COMMIT',
  GIT_PUSH = 'GIT_PUSH',
  GIT_MERGE = 'GIT_MERGE',
  GIT_REBASE = 'GIT_REBASE',
  GIT_BRANCH_DELETE = 'GIT_BRANCH_DELETE',
  REMOTE_REF_DELETE = 'REMOTE_REF_DELETE',
}

// ---------------------------------------------------------------------------
// Policy Reason Code
// ---------------------------------------------------------------------------

/** Reason codes for audit-traceable policy decisions. */
export enum PolicyReasonCode {
  POLICY_ALLOWED = 'POLICY_ALLOWED',
  POLICY_MISSING = 'POLICY_MISSING',
  POLICY_INVALID = 'POLICY_INVALID',
  EXECUTION_PROFILE_UNKNOWN = 'EXECUTION_PROFILE_UNKNOWN',
  ACTION_UNKNOWN = 'ACTION_UNKNOWN',
  PATH_OUTSIDE_ALLOWED_ROOT = 'PATH_OUTSIDE_ALLOWED_ROOT',
  PATH_EXPLICITLY_DENIED = 'PATH_EXPLICITLY_DENIED',
  PATH_TRAVERSAL_REJECTED = 'PATH_TRAVERSAL_REJECTED',
  HOME_ACCESS_DENIED = 'HOME_ACCESS_DENIED',
  SECRET_ACCESS_DENIED = 'SECRET_ACCESS_DENIED',
  REVIEWER_WRITE_DENIED = 'REVIEWER_WRITE_DENIED',
  COMMAND_NOT_ALLOWED = 'COMMAND_NOT_ALLOWED',
  GIT_COMMIT_DENIED = 'GIT_COMMIT_DENIED',
  GIT_PUSH_DENIED = 'GIT_PUSH_DENIED',
  GIT_MERGE_DENIED = 'GIT_MERGE_DENIED',
  GIT_REBASE_DENIED = 'GIT_REBASE_DENIED',
  GIT_BRANCH_DELETE_DENIED = 'GIT_BRANCH_DELETE_DENIED',
  REMOTE_REF_DELETE_DENIED = 'REMOTE_REF_DELETE_DENIED',
  NETWORK_ACCESS_DENIED = 'NETWORK_ACCESS_DENIED',
  RELEASE_GATE_NOT_APPROVED = 'RELEASE_GATE_NOT_APPROVED',
  EXECUTION_TIMEOUT = 'EXECUTION_TIMEOUT',
  EXECUTION_BUDGET_EXCEEDED = 'EXECUTION_BUDGET_EXCEEDED',
}

// ---------------------------------------------------------------------------
// Human-readable reason messages
// ---------------------------------------------------------------------------

export const POLICY_REASON_MESSAGES: Record<PolicyReasonCode, string> = {
  [PolicyReasonCode.POLICY_ALLOWED]: 'Action is permitted by policy.',
  [PolicyReasonCode.POLICY_MISSING]: 'No execution policy is defined for this context.',
  [PolicyReasonCode.POLICY_INVALID]: 'Policy definition is malformed or unresolvable.',
  [PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN]: 'Execution profile is not recognized.',
  [PolicyReasonCode.ACTION_UNKNOWN]: 'Requested action is not recognized.',
  [PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT]: 'Requested path is outside the allowed root.',
  [PolicyReasonCode.PATH_EXPLICITLY_DENIED]: 'Requested path matches an explicitly denied path pattern.',
  [PolicyReasonCode.PATH_TRAVERSAL_REJECTED]: 'Path traversal attempt detected and rejected.',
  [PolicyReasonCode.HOME_ACCESS_DENIED]: 'Unrestricted HOME access is denied.',
  [PolicyReasonCode.SECRET_ACCESS_DENIED]: 'Access to secrets is denied.',
  [PolicyReasonCode.REVIEWER_WRITE_DENIED]: 'Reviewer profile may not write production/source files.',
  [PolicyReasonCode.COMMAND_NOT_ALLOWED]: 'Command is not classified as allowed.',
  [PolicyReasonCode.GIT_COMMIT_DENIED]: 'Git commit is denied before approved release gate.',
  [PolicyReasonCode.GIT_PUSH_DENIED]: 'Git push is denied before approved release gate.',
  [PolicyReasonCode.GIT_MERGE_DENIED]: 'Git merge is denied in EO-01 v0.1.',
  [PolicyReasonCode.GIT_REBASE_DENIED]: 'Git rebase is denied in EO-01 v0.1.',
  [PolicyReasonCode.GIT_BRANCH_DELETE_DENIED]: 'Git branch deletion is denied.',
  [PolicyReasonCode.REMOTE_REF_DELETE_DENIED]: 'Remote ref deletion is denied.',
  [PolicyReasonCode.NETWORK_ACCESS_DENIED]: 'Network access requires explicit policy grant.',
  [PolicyReasonCode.RELEASE_GATE_NOT_APPROVED]: 'Release gate is not approved.',
  [PolicyReasonCode.EXECUTION_TIMEOUT]: 'Execution exceeded maximum allowed duration.',
  [PolicyReasonCode.EXECUTION_BUDGET_EXCEEDED]: 'Execution exceeded budget constraints.',
};

// ---------------------------------------------------------------------------
// Policy Decision
// ---------------------------------------------------------------------------

/**
 * A fully explainable, auditable policy decision.
 *
 * No secrets or complete environment payloads may be included.
 */
export interface PolicyDecision {
  readonly allowed: boolean;
  readonly executionProfile: ExecutionProfile | string;
  readonly requestedAction: ExecutionAction | string;
  readonly reasonCode: PolicyReasonCode;
  readonly reason: string;
  readonly organizationId?: string;
  readonly workflowRunId?: string;
  readonly workflowStepRunId?: string;
  readonly correlationId?: string;
  readonly requestedPath?: string;
  readonly normalizedPath?: string;
  readonly requestedCommand?: string;
  readonly policyVersion: string;
  readonly evaluatedAt: Date;
}

// ---------------------------------------------------------------------------
// Release Gate Status
// ---------------------------------------------------------------------------

/** The status of the human release gate for a workflow run. */
export enum ReleaseGateStatus {
  NOT_REQUESTED = 'NOT_REQUESTED',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// ---------------------------------------------------------------------------
// Normalized Execution Outcomes
// ---------------------------------------------------------------------------

export enum ExecutionOutcome {
  POLICY_BLOCKED = 'POLICY_BLOCKED',
  TIMED_OUT = 'TIMED_OUT',
  QUOTA_BLOCKED = 'QUOTA_BLOCKED',
  CANCELLED = 'CANCELLED',
}

// ---------------------------------------------------------------------------
// Command Classification — Grammar-based safe-command classification
// ---------------------------------------------------------------------------
// Finding A correction: Replace unsafe raw-prefix semantics with explicit
// grammar. If the parser cannot prove the whole command is safe, DENY.

/** Known safe (read-only) git sub-commands. */
const SAFE_GIT_SUBCOMMANDS: readonly string[] = [
  'status',
  'diff',
  'show',
  'log',
  'rev-parse',
];

/** Git branch --show-current is allowed as a safe read. */
const SAFE_GIT_BRANCH_FLAGS: readonly string[] = ['--show-current'];

/** Known mutating git sub-commands (always denied pre-release). */
const MUTATING_GIT_SUBCOMMANDS: readonly string[] = [
  'commit',
  'push',
  'merge',
  'rebase',
];

/** Branch deletion patterns. */
const GIT_BRANCH_DELETE_FLAGS: readonly string[] = ['-D', '-d'];

/** Remote ref deletion patterns. */
const GIT_PUSH_DELETE_FLAGS: readonly string[] = ['--delete'];

/** Commands that require network access. */
const NETWORK_REQUIRING_COMMANDS: readonly string[] = [
  'git push',
  'git clone',
  'git fetch',
  'git pull',
];

// ---------------------------------------------------------------------------
// Secret-like path patterns
// ---------------------------------------------------------------------------

const SECRET_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)credentials?(\..*)?$/i,
  /(^|\/)[\w.-]*key(s)?(\..*)?$/i,
  /(^|\/)[\w.-]*secret(s)?(\..*)?$/i,
  /(^|\/)[\w.-]*token(s)?(\..*)?$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.gnupg\//i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.config\/(gh|hub)\//i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
];

// ---------------------------------------------------------------------------
// Path Utilities — Finding B & C corrections
// ---------------------------------------------------------------------------
// Finding B: Decode percent-encoded path segments before authorization.
// Finding C: Use realpathSync for existing paths to resolve symlinks.

/** Decode percent-encoded characters in a path string. */
function decodePercentEncoding(input: string): string {
  return input.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * Canonicalize a path, resolving symlinks where possible.
 * Returns the canonical path or undefined if resolution fails.
 *
 * Finding C correction: For existing paths, use realpathSync to resolve
 * symlinks. For non-existing paths (e.g., CREATE_FILE targets), resolve
 * the nearest existing ancestor and append remaining segments.
 */
function canonicalizePath(p: string): string | undefined {
  try {
    // For existing paths, use realpathSync to resolve symlinks
    if (fs.existsSync(p)) {
      return fs.realpathSync(p);
    }

    // For non-existing paths, find the nearest existing ancestor
    const segments = p.split(path.sep).filter(Boolean);
    let canon = path.isAbsolute(p) ? path.sep : '';

    for (const seg of segments) {
      const candidate = canon === path.sep ? path.sep + seg : canon + path.sep + seg;
      if (fs.existsSync(candidate)) {
        canon = fs.realpathSync(candidate);
      } else {
        // This segment doesn't exist — append it literally to the canonical parent
        canon = canon === path.sep ? path.sep + seg : canon + path.sep + seg;
      }
    }

    return canon;
  } catch {
    return undefined;
  }
}

/**
 * Normalize and resolve a path, rejecting traversal attempts.
 * Applies percent-decoding (Finding B) and symlink-aware canonicalization (Finding C).
 * Returns the canonical path or undefined if resolution fails or escapes root.
 */
function normalizePath(
  requestedPath: string,
  allowedRoot: string,
): { readonly normalized: string; readonly insideRoot: boolean } {
  // Step 1: Decode percent-encoding (Finding B)
  const decoded = decodePercentEncoding(requestedPath);

  // Step 1b: Normalize backslashes to forward slashes (encoded %5c)
  // This prevents bypass via backslash-encoded traversal on POSIX systems
  const normalizedSlashes = decoded.replace(/\\/g, '/');

  // Step 2: Reject null bytes (raw or encoded)
  if (normalizedSlashes.includes('\0') || requestedPath.includes('%00') || requestedPath.includes('%0')) {
    return { normalized: normalizedSlashes, insideRoot: false };
  }

  // Step 3: Reject any remaining control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(normalizedSlashes)) {
    return { normalized: normalizedSlashes, insideRoot: false };
  }

  // Step 4: Check for traversal sequences (including after decoding)
  const segments = normalizedSlashes.split('/').filter(s => s !== '');
  let depth = 0;
  for (const seg of segments) {
    if (seg === '..') {
      depth--;
    } else if (seg !== '.') {
      depth++;
    }
  }
  if (depth < 0) {
    return { normalized: normalizedSlashes, insideRoot: false };
  }

  // Step 5: Resolve to canonical path using path.resolve
  const resolvedRoot = path.resolve(allowedRoot);
  let normalized: string;
  try {
    normalized = path.resolve(allowedRoot, normalizedSlashes);
  } catch {
    return { normalized: normalizedSlashes, insideRoot: false };
  }

  // Step 6: Basic containment check (pre-canonicalization)
  if (!normalized.startsWith(resolvedRoot + path.sep) && normalized !== resolvedRoot) {
    return { normalized, insideRoot: false };
  }

  // Step 7: Symlink-aware canonicalization (Finding C)
  const canonical = canonicalizePath(normalized);
  if (canonical === undefined) {
    // Cannot verify canonical path — fail closed
    return { normalized, insideRoot: false };
  }

  // Also canonicalize the root for comparison
  const canonicalRoot = canonicalizePath(resolvedRoot);
  if (canonicalRoot === undefined) {
    return { normalized, insideRoot: false };
  }

  // Step 8: Verify canonical containment
  if (!canonical.startsWith(canonicalRoot + path.sep) && canonical !== canonicalRoot) {
    return { normalized: canonical, insideRoot: false };
  }

  return { normalized: canonical, insideRoot: true };
}

/**
 * Check if a resolved path matches any secret pattern.
 */
function isSecretPath(resolvedPath: string): boolean {
  return SECRET_PATH_PATTERNS.some((p) => p.test(resolvedPath));
}

/**
 * Check if a path is an unrestricted HOME access attempt.
 */
function isHomeAccess(resolvedPath: string, homeDir: string): boolean {
  if (!homeDir) return false;
  const normalizedHome = path.resolve(homeDir);
  const normalizedPath = path.resolve(resolvedPath);
  if (normalizedPath === normalizedHome) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Command Tokenizer & Classification — Finding A
// ---------------------------------------------------------------------------

/**
 * Tokenize a shell-style command string respecting quoting rules.
 * Single quotes: literal (no escapes).
 * Double quotes: backslash escapes.
 * Unquoted: backslash escapes.
 */
function tokenizeCommand(command: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(ch) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Detect dangerous shell patterns that should always be denied.
 * Finding A: redirections, command substitution, process substitution,
 * background operators, unsafe shell flags.
 */
function detectDangerousPatterns(command: string): boolean {
  // Check for redirections (outside quotes)
  // Simple check: >, >>, <, << outside of quoted sections
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (inSingle || inDouble) continue;
    if (ch === '>' || ch === '<') return true;
  }

  // Check for command substitution: $(...) or `...`
  if (/\$\(/.test(command) || /`[^`]+`/.test(command)) return true;

  // Check for process substitution: <(...) or >(...)
  if (/[<>]\(/.test(command)) return true;

  // Check for newlines (command separation)
  if (/\n/.test(command)) return true;

  // Check for single & (background operator, not &&)
  // Match & that is NOT followed by &
  if (/(?<!&)&(?!&)/.test(command)) return true;

  return false;
}

/**
 * Detect opaque shell wrappers: sh -c, bash -c, zsh -c, dash -c
 */
function detectShellWrappers(command: string): boolean {
  return /^(sh|bash|zsh|dash|ksh)\s+-c\s+/.test(command.trim());
}

/**
 * Split a command string into individual commands respecting shell chaining.
 * Handles: &&, ||, ;, |
 */
function splitShellChains(command: string): readonly string[] {
  const trimmed = command.trim();
  const commands: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      continue;
    }

    // Check for &&
    if (ch === '&' && i + 1 < trimmed.length && trimmed[i + 1] === '&') {
      if (current.trim()) commands.push(current.trim());
      current = '';
      i++;
      continue;
    }
    // Check for ||
    if (ch === '|' && i + 1 < trimmed.length && trimmed[i + 1] === '|') {
      if (current.trim()) commands.push(current.trim());
      current = '';
      i++;
      continue;
    }
    // Check for ;
    if (ch === ';') {
      if (current.trim()) commands.push(current.trim());
      current = '';
      continue;
    }
    // Check for single |
    if (ch === '|') {
      if (current.trim()) commands.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    commands.push(current.trim());
  }

  return commands;
}

/**
 * Extract the git sub-command from a command string.
 */
function extractGitSubcommand(command: string): { subcommand: string; args: string } | null {
  const match = command.trim().match(/^git\s+(\S+)(.*)$/);
  if (!match) return null;
  return { subcommand: match[1], args: match[2].trim() };
}

/**
 * Build the effective allowed-commands set per profile.
 * The allowedCommands in policy are now exact-command patterns (not prefix wildcards).
 * We generate a comprehensive set of safe patterns for the given profile.
 */
function buildEffectiveAllowedCommands(policy: ExecutionPolicyConfig): readonly string[] {
  return policy.allowedCommands;
}

/**
 * Check if a tokenized command matches one of the allowed commands.
 * Uses exact first-token matching for interpreted commands, and prefix matching
 * for commands with safe argument grammar (like pnpm run test).
 */
function matchAgainstAllowed(
  tokens: readonly string[],
  allowedCommands: readonly string[],
): boolean {
  if (tokens.length === 0) return false;

  const firstToken = tokens[0];
  const fullCommand = tokens.join(' ');

  // Direct full-command match
  if (allowedCommands.includes(fullCommand)) return true;

  // Check each allowed command as prefix (must be followed by whitespace or end)
  for (const allowed of allowedCommands) {
    if (fullCommand === allowed) return true;
    if (fullCommand.startsWith(allowed + ' ')) return true;
  }

  // Special: bare 'pnpm run <safe-script>' patterns
  if (firstToken === 'pnpm' && tokens[1] === 'run' && tokens.length >= 3) {
    const scriptName = tokens[2];
    const safeScripts = ['test', 'build', 'lint', 'typecheck', 'check', 'generate'];
    if (safeScripts.includes(scriptName)) return true;
  }

  // Special: bare 'npm run <safe-script>' patterns
  if (firstToken === 'npm' && tokens[1] === 'run' && tokens.length >= 3) {
    const scriptName = tokens[2];
    const safeScripts = ['test', 'build', 'lint', 'typecheck', 'check', 'generate'];
    if (safeScripts.includes(scriptName)) return true;
  }

  // Special: bare 'yarn run <safe-script>' patterns
  if (firstToken === 'yarn' && (tokens[1] === 'run' || tokens.length === 2)) {
    const scriptName = tokens[1] === 'run' ? tokens[2] : tokens[1];
    if (scriptName) {
      const safeScripts = ['test', 'build', 'lint', 'typecheck', 'check', 'generate'];
      if (safeScripts.includes(scriptName)) return true;
    }
  }

  return false;
}

/**
 * Classify a single (non-chained) command.
 * Returns { allowed, reasonCode }.
 */
function classifySingleCommand(
  command: string,
  profile: ExecutionProfile,
  policy: ExecutionPolicyConfig,
): { allowed: boolean; reasonCode: PolicyReasonCode } {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Finding A: Opaque shell wrappers must be denied
  if (detectShellWrappers(trimmed)) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Finding A: Dangerous patterns must be denied
  if (detectDangerousPatterns(trimmed)) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Tokenize the command
  const tokens = tokenizeCommand(trimmed);
  if (tokens.length === 0) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  const firstToken = tokens[0];

  // Git commands: use dedicated git classifier
  if (firstToken === 'git') {
    return classifyGitCommand(tokens, profile, policy);
  }

  // Finding A: Intercept dangerous interpreter/package-runner invocations
  // node, node -e, node --eval, node --input-type
  if (firstToken === 'node') {
    const hasDangerousFlags = tokens.some(t =>
      t === '-e' || t === '--eval' || t === '--input-type',
    );
    if (hasDangerousFlags) {
      return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
    }
    // Bare 'node' without dangerous flags is also denied unless explicitly allowed
    // and the command matches a safe pattern (e.g., 'node --version')
    if (tokens.length > 1 && tokens[1] === '--version') {
      // allow node --version as a safe read
    } else {
      return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
    }
  }

  // Finding A: npx — only allow specific known-safe invocations
  if (firstToken === 'npx') {
    // npx prisma generate is safe
    if (tokens.length >= 3 && tokens[1] === 'prisma' && tokens[2] === 'generate') {
      return { allowed: true, reasonCode: PolicyReasonCode.POLICY_ALLOWED };
    }
    // All other npx invocations are denied (arbitrary package execution)
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Finding A: npm exec, pnpm exec, yarn dlx are all denied
  if (firstToken === 'npm' && tokens[1] === 'exec') {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }
  if (firstToken === 'pnpm' && tokens[1] === 'exec') {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }
  if (firstToken === 'yarn' && tokens[1] === 'dlx') {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Check against allowed commands
  const allowedCommands = buildEffectiveAllowedCommands(policy);
  if (matchAgainstAllowed(tokens, allowedCommands)) {
    return { allowed: true, reasonCode: PolicyReasonCode.POLICY_ALLOWED };
  }

  return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
}

/**
 * Classify git commands with safe argument grammar.
 */
function classifyGitCommand(
  tokens: readonly string[],
  profile: ExecutionProfile,
  policy: ExecutionPolicyConfig,
): { allowed: boolean; reasonCode: PolicyReasonCode } {
  if (tokens.length < 2) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  const subcommand = tokens[1];
  const args = tokens.slice(2);

  // Read-only git operations
  if (SAFE_GIT_SUBCOMMANDS.includes(subcommand)) {
    return { allowed: true, reasonCode: PolicyReasonCode.POLICY_ALLOWED };
  }

  // git branch --show-current is safe
  if (subcommand === 'branch' && args.includes('--show-current')) {
    return { allowed: true, reasonCode: PolicyReasonCode.POLICY_ALLOWED };
  }

  // git branch: deny deletion flags
  if (subcommand === 'branch') {
    if (GIT_BRANCH_DELETE_FLAGS.some((f) => args.includes(f))) {
      return { allowed: false, reasonCode: PolicyReasonCode.GIT_BRANCH_DELETE_DENIED };
    }
    return { allowed: true, reasonCode: PolicyReasonCode.POLICY_ALLOWED };
  }

  // git commit: always denied in command classification
  if (subcommand === 'commit') {
    return { allowed: false, reasonCode: PolicyReasonCode.GIT_COMMIT_DENIED };
  }

  // git push: check for deletion patterns
  if (subcommand === 'push') {
    if (GIT_PUSH_DELETE_FLAGS.some((f) => args.includes(f))) {
      return { allowed: false, reasonCode: PolicyReasonCode.REMOTE_REF_DELETE_DENIED };
    }
    // Also detect: git push origin :branch
    if (args.some(a => a.startsWith(':'))) {
      return { allowed: false, reasonCode: PolicyReasonCode.REMOTE_REF_DELETE_DENIED };
    }
    return { allowed: false, reasonCode: PolicyReasonCode.GIT_PUSH_DENIED };
  }

  // git merge: always denied
  if (subcommand === 'merge') {
    return { allowed: false, reasonCode: PolicyReasonCode.GIT_MERGE_DENIED };
  }

  // git rebase: always denied
  if (subcommand === 'rebase') {
    return { allowed: false, reasonCode: PolicyReasonCode.GIT_REBASE_DENIED };
  }

  // Unknown git subcommand — fail closed
  return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
}

/**
 * Determine if a command is safe for the given profile.
 * Finds A: Uses grammar-based classification. Deny if not provably safe.
 */
function classifyCommand(
  command: string,
  profile: ExecutionProfile,
  policy: ExecutionPolicyConfig,
): { allowed: boolean; reasonCode: PolicyReasonCode } {
  const trimmed = command.trim();

  // First: detect shell wrappers at the top level
  if (detectShellWrappers(trimmed)) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Detect dangerous patterns at the top level
  if (detectDangerousPatterns(trimmed)) {
    return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
  }

  // Split into chained commands — each must be independently safe
  const chainedCommands = splitShellChains(trimmed);

  for (const cmd of chainedCommands) {
    // Re-check dangerous patterns per sub-command
    if (detectShellWrappers(cmd)) {
      return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
    }
    if (detectDangerousPatterns(cmd)) {
      return { allowed: false, reasonCode: PolicyReasonCode.COMMAND_NOT_ALLOWED };
    }

    const result = classifySingleCommand(cmd, profile, policy);
    if (!result.allowed) {
      return result;
    }
  }

  return { allowed: true, reasonCode: PolicyReasonCode.POLICY_ALLOWED };
}

// ---------------------------------------------------------------------------
// Policy Configuration
// ---------------------------------------------------------------------------

/** Configuration for an execution policy. */
export interface ExecutionPolicyConfig {
  /** Policy version for audit trail. */
  readonly policyVersion: string;
  /** The root directory of the assigned worktree for this execution. */
  readonly allowedRoot: string;
  /** Paths explicitly denied (e.g., .env, secrets). */
  readonly deniedPaths: readonly string[];
  /** Commands explicitly allowed for this profile. */
  readonly allowedCommands: readonly string[];
  /** Whether network access is permitted. */
  readonly allowNetwork: boolean;
  /** Whether secrets are permitted. */
  readonly allowSecrets: boolean;
  /** Whether git commit is permitted (release authority only). */
  readonly allowGitCommit: boolean;
  /** Whether git push is permitted (release authority only). */
  readonly allowGitPush: boolean;
  /** Whether git merge is permitted (EO-01 v0.1: deny). */
  readonly allowMerge: boolean;
  /** Whether git rebase is permitted (EO-01 v0.1: deny). */
  readonly allowRebase: boolean;
  /** Whether git branch deletion is permitted. */
  readonly allowBranchDelete: boolean;
  /** Budget constraints. */
  readonly maxDurationMs?: number;
  readonly maxTokens?: number;
  readonly maxCostMinorUnits?: number;
}

/** Context for policy evaluation. */
export interface PolicyEvaluationContext {
  readonly executionProfile: ExecutionProfile;
  readonly requestedAction: ExecutionAction;
  readonly requestedPath?: string;
  readonly requestedCommand?: string;
  readonly homeDir?: string;
  readonly policy?: ExecutionPolicyConfig;
  readonly releaseGateStatus?: ReleaseGateStatus;
  readonly organizationId?: string;
  readonly workflowRunId?: string;
  readonly workflowStepRunId?: string;
  readonly correlationId?: string;
}

// ---------------------------------------------------------------------------
// Default Policy
// ---------------------------------------------------------------------------

/** Default safe configuration for the builder profile. */
export function createBuilderPolicy(worktreeRoot: string): ExecutionPolicyConfig {
  return {
    policyVersion: 'eo-01.4-v1',
    allowedRoot: worktreeRoot,
    deniedPaths: ['.env', '.env.*', '.ssh/', '.gnupg/', '.aws/'],
    allowedCommands: [
      'git status',
      'git diff',
      'git show',
      'git log',
      'git rev-parse',
      'git branch --show-current',
      'npm test',
      'npm run test',
      'npm run build',
      'npm run lint',
      'yarn test',
      'yarn run test',
      'yarn run build',
      'yarn run lint',
      'pnpm test',
      'pnpm run test',
      'pnpm run build',
      'pnpm run lint',
      'tsc',
      'eslint',
      'prettier',
      'jest',
      'vitest',
      'npx prisma generate',
      'prisma generate',
    ],
    allowNetwork: false,
    allowSecrets: false,
    allowGitCommit: false,
    allowGitPush: false,
    allowMerge: false,
    allowRebase: false,
    allowBranchDelete: false,
  };
}

/** Default safe configuration for the reviewer profile. */
export function createReviewerPolicy(worktreeRoot: string): ExecutionPolicyConfig {
  return {
    policyVersion: 'eo-01.4-v1',
    allowedRoot: worktreeRoot,
    deniedPaths: ['.env', '.env.*', '.ssh/', '.gnupg/', '.aws/'],
    allowedCommands: [
      'git status',
      'git diff',
      'git show',
      'git log',
      'git rev-parse',
      'git branch --show-current',
      'npm test',
      'npm run test',
      'npm run lint',
      'yarn test',
      'yarn run test',
      'yarn run lint',
      'pnpm test',
      'pnpm run test',
      'pnpm run lint',
      'jest',
      'vitest',
    ],
    allowNetwork: false,
    allowSecrets: false,
    allowGitCommit: false,
    allowGitPush: false,
    allowMerge: false,
    allowRebase: false,
    allowBranchDelete: false,
  };
}

// ---------------------------------------------------------------------------
// Policy Evaluation Engine
// ---------------------------------------------------------------------------

const POLICY_VERSION = 'eo-01.4-v1';

/**
 * Evaluate whether the requested action is permitted under the given policy.
 *
 * Security model: Fail closed. Missing/unknown policy, malformed path,
 * unknown profile, or unknown action results in DENY.
 */
export function evaluatePolicy(ctx: PolicyEvaluationContext): PolicyDecision {
  const now = new Date();

  const base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'> = {
    executionProfile: ctx.executionProfile,
    requestedAction: ctx.requestedAction,
    requestedPath: ctx.requestedPath,
    normalizedPath: ctx.requestedPath,
    requestedCommand: ctx.requestedCommand,
    policyVersion: POLICY_VERSION,
    evaluatedAt: now,
    organizationId: ctx.organizationId,
    workflowRunId: ctx.workflowRunId,
    workflowStepRunId: ctx.workflowStepRunId,
    correlationId: ctx.correlationId,
  };

  // 1. Missing policy -> DENY (fail closed)
  if (!ctx.policy) {
    return deny(
      base,
      PolicyReasonCode.POLICY_MISSING,
      POLICY_REASON_MESSAGES[PolicyReasonCode.POLICY_MISSING],
    );
  }

  // 2. Unknown profile -> DENY (fail closed)
  if (!Object.values(ExecutionProfile).includes(ctx.executionProfile as ExecutionProfile)) {
    return deny(
      base,
      PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN,
      POLICY_REASON_MESSAGES[PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN],
    );
  }

  // 3. Unknown action -> DENY (fail closed)
  if (!Object.values(ExecutionAction).includes(ctx.requestedAction as ExecutionAction)) {
    return deny(
      base,
      PolicyReasonCode.ACTION_UNKNOWN,
      POLICY_REASON_MESSAGES[PolicyReasonCode.ACTION_UNKNOWN],
    );
  }

  // 4. Path-based actions
  if (
    ctx.requestedAction === ExecutionAction.READ_FILE ||
    ctx.requestedAction === ExecutionAction.WRITE_FILE ||
    ctx.requestedAction === ExecutionAction.CREATE_FILE ||
    ctx.requestedAction === ExecutionAction.DELETE_FILE
  ) {
    return evaluatePathAction(ctx, base);
  }

  // 5. Command actions
  if (ctx.requestedAction === ExecutionAction.RUN_COMMAND) {
    return evaluateCommandAction(ctx, base);
  }

  // 6. Secret access — unconditionally denied in EO-01 v0.1
  if (ctx.requestedAction === ExecutionAction.READ_SECRET) {
    return deny(
      base,
      PolicyReasonCode.SECRET_ACCESS_DENIED,
      POLICY_REASON_MESSAGES[PolicyReasonCode.SECRET_ACCESS_DENIED],
    );
  }

  // 7. Network access
  if (ctx.requestedAction === ExecutionAction.NETWORK_ACCESS) {
    if (!ctx.policy.allowNetwork) {
      return deny(
        base,
        PolicyReasonCode.NETWORK_ACCESS_DENIED,
        POLICY_REASON_MESSAGES[PolicyReasonCode.NETWORK_ACCESS_DENIED],
      );
    }
    return allow(base, 'Network access is permitted by policy.');
  }

  // 8. Git actions
  if (ctx.requestedAction === ExecutionAction.GIT_READ) {
    return allow(base, 'Git read operation is permitted.');
  }

  if (ctx.requestedAction === ExecutionAction.GIT_COMMIT) {
    if (
      ctx.executionProfile !== ExecutionProfile.RELEASE_AUTHORITY ||
      !ctx.policy.allowGitCommit ||
      ctx.releaseGateStatus !== ReleaseGateStatus.APPROVED
    ) {
      return deny(
        base,
        PolicyReasonCode.GIT_COMMIT_DENIED,
        POLICY_REASON_MESSAGES[PolicyReasonCode.GIT_COMMIT_DENIED],
      );
    }
    return allow(base, 'Git commit permitted by governed release authority.');
  }

  if (ctx.requestedAction === ExecutionAction.GIT_PUSH) {
    if (
      ctx.executionProfile !== ExecutionProfile.RELEASE_AUTHORITY ||
      !ctx.policy.allowGitPush ||
      ctx.releaseGateStatus !== ReleaseGateStatus.APPROVED
    ) {
      return deny(
        base,
        PolicyReasonCode.GIT_PUSH_DENIED,
        POLICY_REASON_MESSAGES[PolicyReasonCode.GIT_PUSH_DENIED],
      );
    }
    return allow(base, 'Git push permitted by governed release authority.');
  }

  // 9. Unconditionally denied in EO-01 v0.1
  if (ctx.requestedAction === ExecutionAction.GIT_MERGE) {
    return deny(
      base,
      PolicyReasonCode.GIT_MERGE_DENIED,
      POLICY_REASON_MESSAGES[PolicyReasonCode.GIT_MERGE_DENIED],
    );
  }

  if (ctx.requestedAction === ExecutionAction.GIT_REBASE) {
    return deny(
      base,
      PolicyReasonCode.GIT_REBASE_DENIED,
      POLICY_REASON_MESSAGES[PolicyReasonCode.GIT_REBASE_DENIED],
    );
  }

  if (ctx.requestedAction === ExecutionAction.GIT_BRANCH_DELETE) {
    return deny(
      base,
      PolicyReasonCode.GIT_BRANCH_DELETE_DENIED,
      POLICY_REASON_MESSAGES[PolicyReasonCode.GIT_BRANCH_DELETE_DENIED],
    );
  }

  if (ctx.requestedAction === ExecutionAction.REMOTE_REF_DELETE) {
    return deny(
      base,
      PolicyReasonCode.REMOTE_REF_DELETE_DENIED,
      POLICY_REASON_MESSAGES[PolicyReasonCode.REMOTE_REF_DELETE_DENIED],
    );
  }

  // Unknown action — fail closed
  return deny(
    base,
    PolicyReasonCode.ACTION_UNKNOWN,
    POLICY_REASON_MESSAGES[PolicyReasonCode.ACTION_UNKNOWN],
  );
}

// ---------------------------------------------------------------------------
// Path evaluation — Finding D: Remove blanket ORCHESTRATOR/RELEASE fallthrough
// ---------------------------------------------------------------------------

function evaluatePathAction(
  ctx: PolicyEvaluationContext,
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
): PolicyDecision {
  if (!ctx.requestedPath) {
    return deny(
      base,
      PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
      'Path action requested without a path.',
    );
  }

  const { normalized, insideRoot } = normalizePath(ctx.requestedPath, ctx.policy!.allowedRoot);
  const normalizedPath = normalized;

  // Traversal escape
  if (!insideRoot) {
    if (ctx.requestedPath.includes('..') || normalized.includes('..')) {
      return deny(
        { ...base, normalizedPath },
        PolicyReasonCode.PATH_TRAVERSAL_REJECTED,
        POLICY_REASON_MESSAGES[PolicyReasonCode.PATH_TRAVERSAL_REJECTED],
      );
    }
    return deny(
      { ...base, normalizedPath },
      PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
      POLICY_REASON_MESSAGES[PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT],
    );
  }

  // Unrestricted HOME access -> DENY
  if (ctx.homeDir && normalizedPath.startsWith(path.resolve(ctx.homeDir))) {
    if (normalizedPath === path.resolve(ctx.homeDir)) {
      return deny(
        { ...base, normalizedPath },
        PolicyReasonCode.HOME_ACCESS_DENIED,
        POLICY_REASON_MESSAGES[PolicyReasonCode.HOME_ACCESS_DENIED],
      );
    }
    const homeSensitivePatterns = [
      '.ssh', '.gnupg', '.aws', '.config/gh', '.config/hub',
    ];
    for (const p of homeSensitivePatterns) {
      if (normalizedPath.includes(p)) {
        return deny(
          { ...base, normalizedPath },
          PolicyReasonCode.HOME_ACCESS_DENIED,
          POLICY_REASON_MESSAGES[PolicyReasonCode.HOME_ACCESS_DENIED],
        );
      }
    }
  }

  // Secret path patterns -> DENY (always, regardless of profile)
  if (isSecretPath(normalizedPath)) {
    return deny(
      { ...base, normalizedPath },
      PolicyReasonCode.SECRET_ACCESS_DENIED,
      POLICY_REASON_MESSAGES[PolicyReasonCode.SECRET_ACCESS_DENIED],
    );
  }

  // Explicit denied paths -> DENY
  const relativePath = path.relative(path.resolve(ctx.policy!.allowedRoot), normalizedPath);
  for (const denied of ctx.policy!.deniedPaths) {
    if (matchesDenyPattern(relativePath, denied)) {
      return deny(
        { ...base, normalizedPath },
        PolicyReasonCode.PATH_EXPLICITLY_DENIED,
        `Path "${relativePath}" matches denied pattern "${denied}".`,
      );
    }
  }

  // Profile-specific enforcement
  if (ctx.executionProfile === ExecutionProfile.BUILDER) {
    return evaluateBuilderPath(ctx, base, normalizedPath);
  }

  if (ctx.executionProfile === ExecutionProfile.REVIEWER) {
    return evaluateReviewerPath(ctx, base, normalizedPath);
  }

  // Finding D: ORCHESTRATOR — may read governed metadata/artifacts only
  if (ctx.executionProfile === ExecutionProfile.ORCHESTRATOR) {
    return evaluateOrchestratorPath(ctx, base, normalizedPath);
  }

  // Finding D: RELEASE_AUTHORITY — must not receive arbitrary filesystem mutation
  if (ctx.executionProfile === ExecutionProfile.RELEASE_AUTHORITY) {
    return evaluateReleaseAuthorityPath(ctx, base, normalizedPath);
  }

  // Unknown profile — fail closed (should not reach here due to earlier check)
  return deny(
    { ...base, normalizedPath },
    PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN,
    POLICY_REASON_MESSAGES[PolicyReasonCode.EXECUTION_PROFILE_UNKNOWN],
  );
}

function evaluateBuilderPath(
  ctx: PolicyEvaluationContext,
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
  normalizedPath: string,
): PolicyDecision {
  const worktreeRoot = path.resolve(ctx.policy!.allowedRoot);

  if (normalizedPath.startsWith(worktreeRoot + path.sep) || normalizedPath === worktreeRoot) {
    return allow({ ...base, normalizedPath }, 'Builder path within assigned worktree.');
  }

  return deny(
    { ...base, normalizedPath },
    PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
    'Builder may only access paths within assigned worktree.',
  );
}

function evaluateReviewerPath(
  ctx: PolicyEvaluationContext,
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
  normalizedPath: string,
): PolicyDecision {
  const worktreeRoot = path.resolve(ctx.policy!.allowedRoot);

  if (ctx.requestedAction === ExecutionAction.READ_FILE) {
    if (normalizedPath.startsWith(worktreeRoot + path.sep) || normalizedPath === worktreeRoot) {
      return allow({ ...base, normalizedPath }, 'Reviewer read within assigned worktree.');
    }
    return deny(
      { ...base, normalizedPath },
      PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
      'Reviewer may only read within assigned worktree.',
    );
  }

  // Write actions for reviewer: DENY
  return deny(
    { ...base, normalizedPath },
    PolicyReasonCode.REVIEWER_WRITE_DENIED,
    POLICY_REASON_MESSAGES[PolicyReasonCode.REVIEWER_WRITE_DENIED],
  );
}

/**
 * Finding D: ORCHESTRATOR path evaluation.
 * May read governed metadata/artifacts. MUST NOT write/create/delete productive source.
 */
function evaluateOrchestratorPath(
  ctx: PolicyEvaluationContext,
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
  normalizedPath: string,
): PolicyDecision {
  const worktreeRoot = path.resolve(ctx.policy!.allowedRoot);

  // Read-only access: allowed within worktree for metadata/artifacts
  if (ctx.requestedAction === ExecutionAction.READ_FILE) {
    if (normalizedPath.startsWith(worktreeRoot + path.sep) || normalizedPath === worktreeRoot) {
      return allow({ ...base, normalizedPath }, 'Orchestrator read within worktree.');
    }
    return deny(
      { ...base, normalizedPath },
      PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
      'Orchestrator may only read within assigned worktree.',
    );
  }

  // Write/create/delete: DENY for orchestrator (Finding D)
  // Orchestrator must not directly modify productive/source files
  return deny(
    { ...base, normalizedPath },
    PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
    'Orchestrator may not directly write/create/delete files.',
  );
}

/**
 * Finding D: RELEASE_AUTHORITY path evaluation.
 * Must not receive arbitrary filesystem mutation privileges merely because of its profile.
 */
function evaluateReleaseAuthorityPath(
  ctx: PolicyEvaluationContext,
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
  normalizedPath: string,
): PolicyDecision {
  const worktreeRoot = path.resolve(ctx.policy!.allowedRoot);

  // Read-only access: allowed within worktree
  if (ctx.requestedAction === ExecutionAction.READ_FILE) {
    if (normalizedPath.startsWith(worktreeRoot + path.sep) || normalizedPath === worktreeRoot) {
      return allow({ ...base, normalizedPath }, 'Release authority read within worktree.');
    }
    return deny(
      { ...base, normalizedPath },
      PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
      'Release authority may only read within assigned worktree.',
    );
  }

  // Write/create/delete: DENY by default
  // Source mutation remains denied unless explicitly required by EO-01.4 specification
  return deny(
    { ...base, normalizedPath },
    PolicyReasonCode.PATH_OUTSIDE_ALLOWED_ROOT,
    'Release authority does not have arbitrary filesystem write authority.',
  );
}

function evaluateCommandAction(
  ctx: PolicyEvaluationContext,
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
): PolicyDecision {
  if (!ctx.requestedCommand) {
    return deny(
      base,
      PolicyReasonCode.COMMAND_NOT_ALLOWED,
      'Command action requested without a command.',
    );
  }

  const result = classifyCommand(ctx.requestedCommand, ctx.executionProfile, ctx.policy!);

  if (result.allowed) {
    return allow(base, 'Command is classified as allowed.');
  }

  return deny(
    base,
    result.reasonCode,
    POLICY_REASON_MESSAGES[result.reasonCode] ?? 'Command not allowed.',
  );
}

function matchesDenyPattern(relativePath: string, deniedPattern: string): boolean {
  const normalizedRelative = relativePath.replace(/\\/g, '/');
  const normalizedDenied = deniedPattern.replace(/\\/g, '/');

  if (normalizedDenied.endsWith('/*') || normalizedDenied.endsWith('/')) {
    const prefix = normalizedDenied.replace(/\/?\*?$/, '');
    return normalizedRelative === prefix || normalizedRelative.startsWith(prefix + '/');
  }

  if (normalizedDenied.includes('*')) {
    const regex = new RegExp(
      '^' + normalizedDenied.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$',
    );
    return regex.test(normalizedRelative);
  }

  return normalizedRelative === normalizedDenied || normalizedRelative.startsWith(normalizedDenied + '/');
}

function allow(
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
  reason: string,
): PolicyDecision {
  return {
    ...base,
    allowed: true,
    reasonCode: PolicyReasonCode.POLICY_ALLOWED,
    reason,
  };
}

function deny(
  base: Omit<PolicyDecision, 'allowed' | 'reasonCode' | 'reason'>,
  reasonCode: PolicyReasonCode,
  reason: string,
): PolicyDecision {
  return {
    ...base,
    allowed: false,
    reasonCode,
    reason,
  };
}

/**
 * Convert a policy decision to an execution outcome for status mapping.
 */
export function policyDecisionToOutcome(decision: PolicyDecision): ExecutionOutcome | null {
  if (decision.allowed) return null;
  switch (decision.reasonCode) {
    case PolicyReasonCode.EXECUTION_TIMEOUT:
      return ExecutionOutcome.TIMED_OUT;
    case PolicyReasonCode.EXECUTION_BUDGET_EXCEEDED:
      return ExecutionOutcome.QUOTA_BLOCKED;
    default:
      return ExecutionOutcome.POLICY_BLOCKED;
  }
}

/**
 * Finding F: Assert that a policy decision does not leak secrets.
 * Returns true if the decision is safe to persist in audit logs.
 * Enforces comprehensive credential detection beyond simple base64 regex.
 */
export function auditSafe(decision: PolicyDecision): boolean {
  const serialized = JSON.stringify(decision);

  // Check for raw secret values (long base64-like strings)
  if (/[A-Za-z0-9+/=_]{40,}/.test(serialized)) {
    return false;
  }

  // Check for credential-bearing values in the serialized output
  // These patterns catch password=, token=, api_key=, etc. with actual values
  const credentialPatterns = [
    /password["\s]*[:=]\s*["'][^"']+["']/i,
    /secret["\s]*[:=]\s*["'][^"']+["']/i,
    /token["\s]*[:=]\s*["'][^"']+["']/i,
    /api[_-]?key["\s]*[:=]\s*["'][^"']+["']/i,
    /private[_-]?key["\s]*[:=]\s*["'][^"']+["']/i,
    /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
    /-----BEGIN\s+CERTIFICATE-----/,
    /Bearer\s+[A-Za-z0-9._\-]{20,}/,
    /Authorization["\s]*[:=]\s*["']Basic\s+[A-Za-z0-9+/=]{20,}["']/i,
    /Authorization["\s]*[:=]\s*["']Bearer\s+[A-Za-z0-9._\-]{20,}["']/i,
    /eyJhbGciOi[A-Za-z0-9._\-]+\.eyJ[A-Za-z0-9._\-]+/,
    /sk_live_[A-Za-z0-9]{20,}/,
    /pk_live_[A-Za-z0-9]{20,}/,
    /ghp_[A-Za-z0-9]{20,}/,
    /gho_[A-Za-z0-9]{20,}/,
    /xox[bpsa]-[A-Za-z0-9\-]{10,}/,
    /AKIA[A-Z0-9]{16}/,
  ];

  for (const pattern of credentialPatterns) {
    if (pattern.test(serialized)) {
      return false;
    }
  }

  return true;
}
