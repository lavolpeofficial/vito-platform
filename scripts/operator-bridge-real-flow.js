// VITO-OB-002 -- Operator Bridge real-flow harness logic.
//
// Plain CommonJS so the repository's Jest (CJS, ts-jest) can load it directly.
// scripts/operator-bridge-real-flow.mjs is the thin CLI entry that imports the
// named exports here; run `node scripts/operator-bridge-real-flow.mjs`.
//
// Operator-side client that proves one real VITO operator roundtrip through the
// existing Operator Bridge (`POST /v1/operator/tasks`, `GET /v1/operator/tasks/:taskId`)
// and the real configured `CODE_BUILD` provider.
//
// Execution authority stays entirely server-side: this harness never invokes OpenCode,
// Bubblewrap, the RemoteExecutionWorker, git mutation, repository writes, patch
// application, branch/commit/push, or any internal execution path.
//
// Credentials are environment-only:
//   VITO_BASE_URL          HTTPS or local test endpoint of the VITO API
//   VITO_OPERATOR_TOKEN    JWT for a MEMBER machine identity with machineScope=vito-bridge
//
// Status handling is derived from the authoritative OperatorTaskStatus contract
// (@vito/contracts / Prisma): DISPATCHING, COMPLETED, HUMAN_GATE, FAILED.
// See operator-bridge-real-flow-harness.spec.ts for the contract-drift guard.

'use strict';

const { randomUUID } = require('node:crypto');

// ---------------------------------------------------------------------------
// Canonical task contract (mirror of packages/contracts OperatorTaskStatus).
// ---------------------------------------------------------------------------

const OPERATOR_TASK_STATUSES = Object.freeze([
  'DISPATCHING',
  'COMPLETED',
  'HUMAN_GATE',
  'FAILED',
]);

const TERMINAL_STATUSES = Object.freeze(new Set(['COMPLETED', 'HUMAN_GATE', 'FAILED']));

const SUCCESS_STATUS = 'COMPLETED';

const IDEMPOTENCY_CONFLICT_CODE = 'OPERATOR_IDEMPOTENCY_CONFLICT';

// ---------------------------------------------------------------------------
// Canonical first real task.
// ---------------------------------------------------------------------------

const CANONICAL_CAPABILITY_CODE = 'CODE_BUILD';

const CANONICAL_PROOF_PATH = 'docs/engineering/operator-bridge-real-flow-proof.md';

const CANONICAL_PROOF_TITLE = '# Operator Bridge Real Flow Proof';

const CANONICAL_PROOF_SENTENCE =
  'This file was created by a governed VITO operator task.';

const CANONICAL_PROOF_CONTENT = `${CANONICAL_PROOF_TITLE}

${CANONICAL_PROOF_SENTENCE}`;

function buildCanonicalPrompt() {
  return `Create exactly one new documentation file at ${CANONICAL_PROOF_PATH} with exactly this content:

${CANONICAL_PROOF_CONTENT}

Make no unrelated changes. Do not modify, create, or delete any other file.`;
}

function buildCanonicalSubmitBody(requestId, budget) {
  const resolvedBudget = budget ?? {
    maxDurationMs: 300000,
    maxTokens: 100000,
    maxCostMinorUnits: 0,
  };
  return {
    requestId,
    capabilityCode: CANONICAL_CAPABILITY_CODE,
    prompt: buildCanonicalPrompt(),
    budget: resolvedBudget,
  };
}

function buildConflictProbeBody(requestId) {
  return {
    requestId,
    capabilityCode: CANONICAL_CAPABILITY_CODE,
    prompt:
      'Create exactly one new documentation file at docs/engineering/operator-bridge-conflict-probe.md with content "# Operator Bridge Conflict Probe" and make no unrelated changes.',
  };
}

// ---------------------------------------------------------------------------
// Environment and redaction.
// ---------------------------------------------------------------------------

const ENV_VAR_BASE_URL = 'VITO_BASE_URL';
const ENV_VAR_TOKEN = 'VITO_OPERATOR_TOKEN';

const REDACTED = '[REDACTED]';

const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN\s+(RSA\s+)?(EC\s+)?PRIVATE\s+KEY-----[\s\S]*?(-----END\s+([A-Z0-9]+\s+)?PRIVATE\s+KEY-----|$)/,
  /\bBearer\s+[A-Za-z0-9._\-]{20,}\b/,
  /\bBasic\s+[A-Za-z0-9+/=]{20,}\b/,
  /\beyJhbGciOi[A-Za-z0-9._\-]+\.eyJ[A-Za-z0-9._\-]+/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bgh[posr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[bpsa]-[A-Za-z0-9\-]{10,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
]);

class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HarnessError';
  }
}

class ConfigurationError extends HarnessError {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function requireEnv(name, env = process.env) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConfigurationError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Redact the Bearer credential and any secret-shaped material. */
function redact(text, token) {
  let out = String(text ?? '');
  if (typeof token === 'string' && token.length > 0) {
    out = out.split(token).join(REDACTED);
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function safeText(value, token) {
  return redact(value, token);
}

// ---------------------------------------------------------------------------
// Repository contract helpers (pure, unit-testable).
// ---------------------------------------------------------------------------

function isKnownStatus(status) {
  return OPERATOR_TASK_STATUSES.includes(status);
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

/** Polling policy: bounded interval and hard overall timeout. */
function pollPolicy({ intervalMs = 5000, maxWaitMs = 360000 } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new ConfigurationError('poll interval must be a finite positive number');
  }
  if (!Number.isFinite(maxWaitMs) || maxWaitMs <= 0) {
    throw new ConfigurationError('poll maxWait must be a finite positive number');
  }
  return Object.freeze({ intervalMs, maxWaitMs });
}

function deadlineAt(startMs, policy) {
  return startMs + policy.maxWaitMs;
}

function isPastDeadline(nowMs, deadlineMs) {
  return nowMs >= deadlineMs;
}

/** Exactly the canonical proof path and no other changed file. */
function assertChangedFiles(changedFiles) {
  const failures = [];
  if (!Array.isArray(changedFiles)) {
    failures.push('result did not expose a changedFiles list');
    return failures;
  }
  if (changedFiles.length !== 1) {
    failures.push(`expected exactly one changed file but got ${changedFiles.length}`);
    return failures;
  }
  if (changedFiles[0] !== CANONICAL_PROOF_PATH) {
    failures.push(
      `unexpected changed file "${safeText(changedFiles[0], '')}"; expected "${CANONICAL_PROOF_PATH}"`,
    );
  }
  return failures;
}

function patchContainsAddition(patch, text) {
  return (
    typeof patch === 'string' &&
    (patch.includes(text) || patch.includes(`+${text}`) || patch.includes(`-${text}`))
  );
}

/** Non-empty governed patch containing the intended file addition. */
function assertPatchContent(patch) {
  const failures = [];
  if (typeof patch !== 'string' || patch.length === 0) {
    failures.push('governed patch is empty or missing');
    return failures;
  }
  if (!patchContainsAddition(patch, CANONICAL_PROOF_TITLE)) {
    failures.push('governed patch does not contain the intended proof title');
  }
  if (!patchContainsAddition(patch, CANONICAL_PROOF_SENTENCE)) {
    failures.push('governed patch does not contain the intended proof sentence');
  }
  return failures;
}

function assertWorkspaceCleaned(disposition) {
  if (disposition === 'CLEANED') return [];
  return [
    `workspace is not CLEANED (${disposition === undefined ? 'field absent' : safeText(disposition, '')})`,
  ];
}

function findCredentialLeaks(text, token) {
  const sample = String(text ?? '');
  const leaks = [];
  if (typeof token === 'string' && token.length > 0 && sample.includes(token)) {
    leaks.push('credential value appears verbatim');
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(sample)) {
      leaks.push(`secret-shaped material matches ${pattern}`);
    }
  }
  return leaks;
}

function assertNoCredentialLeakage(result, token) {
  const failures = [];
  for (const field of ['stdout', 'stderr', 'patch']) {
    const value = result?.[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    for (const leak of findCredentialLeaks(value, token)) {
      failures.push(`${field} leaks ${leak}`);
    }
  }
  return failures;
}

function assertTerminalResult(result, token) {
  const failures = [];
  const status = result?.status;
  if (!isKnownStatus(status)) {
    failures.push(`unexpected task status ${safeText(status, token)}`);
    return failures;
  }
  if (!isTerminalStatus(status)) {
    failures.push(`task did not reach a terminal status (still ${safeText(status, token)})`);
    return failures;
  }
  if (status !== SUCCESS_STATUS) {
    const reason = result?.error?.reason;
    const message = result?.error?.message;
    failures.push(
      `task reached ${status}${reason ? ` (${safeText(reason, token)})` : ''}${
        message ? ` -- ${safeText(message, token)}` : ''
      }`,
    );
    return failures;
  }
  if (!result?.provider?.providerCode) {
    failures.push('result did not identify the routed real provider');
  }
  if (result?.capabilityCode !== CANONICAL_CAPABILITY_CODE) {
    failures.push(
      `result capabilityCode is ${safeText(result?.capabilityCode, token)}; expected ${CANONICAL_CAPABILITY_CODE}`,
    );
  }
  failures.push(...assertChangedFiles(result?.changedFiles));
  if (result?.sensitivePayloadAvailable === false) {
    failures.push('sensitive payload already expired before the governed patch could be verified');
  } else {
    failures.push(...assertPatchContent(result?.patch));
  }
  failures.push(...assertWorkspaceCleaned(result?.workspaceDisposition));
  failures.push(...assertNoCredentialLeakage(result, token));
  return failures;
}

function assertDurableConsistency(first, second) {
  const failures = [];
  for (const field of [
    'taskId',
    'requestId',
    'correlationId',
    'status',
    'workflowRunId',
    'workflowStepRunId',
  ]) {
    if (String(first?.[field] ?? null) !== String(second?.[field] ?? null)) {
      failures.push(`second GET changed ${field}`);
    }
  }
  if (first?.provider?.providerCode !== second?.provider?.providerCode) {
    failures.push('second GET changed routed provider metadata');
  }
  if (JSON.stringify(first?.changedFiles ?? null) !== JSON.stringify(second?.changedFiles ?? null)) {
    failures.push('second GET changed changedFiles');
  }
  if (String(first?.patch ?? null) !== String(second?.patch ?? null)) {
    failures.push('second GET changed governed patch');
  }
  if (first?.workspaceDisposition !== second?.workspaceDisposition) {
    failures.push('second GET changed workspaceDisposition');
  }
  return failures;
}

function assertExactReplay(original, replay) {
  const failures = [];
  if (replay?.httpStatus !== 200) {
    failures.push(
      `exact replay was not accepted idempotently (HTTP ${safeText(replay?.httpStatus, '')})`,
    );
    return failures;
  }
  if (replay?.taskId !== original?.taskId) {
    failures.push('exact replay resolved to a different taskId');
  }
  if (replay?.requestId !== original?.requestId) {
    failures.push('exact replay resolved to a different requestId');
  }
  return failures;
}

function isIdempotencyConflict(response, token) {
  return (
    response?.httpStatus === 409 &&
    safeText(response?.json?.message, token) === IDEMPOTENCY_CONFLICT_CODE
  );
}

function assertConflictingReplayRejected(response, token) {
  if (isIdempotencyConflict(response, token)) return [];
  return [
    `conflicting replay did not fail closed (HTTP ${safeText(response?.httpStatus, token)}, message ${safeText(
      response?.json?.message,
      token,
    )})`,
  ];
}

// ---------------------------------------------------------------------------
// HTTP client helpers (pure wrappers around fetch).
// ---------------------------------------------------------------------------

function requestHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function readJsonResponse(response) {
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { httpStatus: response.status, ok: response.ok, json };
}

async function postTask(fetchImpl, baseUrl, token, body) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/operator/tasks`, {
      method: 'POST',
      headers: requestHeaders(token),
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new HarnessError(`transport error posting operator task: ${safeText(error?.message, token)}`);
  }
  return readJsonResponse(response);
}

async function getTask(fetchImpl, baseUrl, token, taskId) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/operator/tasks/${taskId}`, {
      method: 'GET',
      headers: requestHeaders(token),
    });
  } catch (error) {
    throw new HarnessError(
      `transport error retrieving operator task: ${safeText(error?.message, token)}`,
    );
  }
  return readJsonResponse(response);
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollForTerminal(fetchImpl, baseUrl, token, taskId, policy, tokenValue, deps = {}) {
  const now = deps.now ?? Date.now;
  const sleeper = deps.sleep ?? realSleep;
  const start = now();
  const deadline = start + policy.maxWaitMs;
  for (;;) {
    const response = await getTask(fetchImpl, baseUrl, token, taskId);
    const status = response?.json?.status;
    if (!isKnownStatus(status)) {
      return {
        timedOut: false,
        response,
        error: `unexpected task status ${safeText(status, tokenValue)}`,
      };
    }
    if (isTerminalStatus(status)) {
      return { timedOut: false, response, error: null };
    }
    if (isPastDeadline(now() + policy.intervalMs, deadline)) {
      return {
        timedOut: true,
        response,
        error: 'task did not reach a terminal status before the poll deadline',
      };
    }
    await sleeper(policy.intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

async function run(config = {}) {
  const env = config.env ?? process.env;
  const tokenValue = requireEnv(ENV_VAR_TOKEN, env);
  const baseUrl = requireEnv(ENV_VAR_BASE_URL, env).replace(/\/+$/, '');
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ConfigurationError('HTTP fetch is unavailable in this Node runtime.');
  }
  const policy = pollPolicy(config.policy);
  const requestId = config.requestId ?? randomUUID();
  const body = buildCanonicalSubmitBody(requestId, config.budget);
  const now = config.now ?? Date.now;
  const sleeper = config.sleep ?? realSleep;
  const summary = [];
  const failures = [];
  const pushFailures = (list) => {
    for (const entry of list) failures.push(safeText(entry, tokenValue));
  };
  const outcome = { ok: false, requestId, taskId: null, status: null, failures, summary };

  summary.push(`submit requestId=${safeText(requestId, tokenValue)}`);

  // 1. POST the canonical task.
  const post = await postTask(fetchImpl, baseUrl, tokenValue, body);
  if (post.httpStatus !== 200) {
    pushFailures([
      `POST /v1/operator/tasks failed (HTTP ${post.httpStatus}): ${safeText(post?.json?.message, tokenValue)}`,
    ]);
    outcome.summary = summary;
    return outcome;
  }
  const created = post.json;
  outcome.taskId = created?.taskId ?? null;
  outcome.status = created?.status ?? null;
  if (!created?.taskId) {
    pushFailures(['POST response did not expose a taskId']);
  }
  if (created?.requestId !== requestId) {
    pushFailures(['POST did not echo the requestId']);
  }

  // 2. Fetch the full governed result, polling while DISPATCHING.
  // A fresh submission may already be terminal with only the minimal
  // SubmitOperatorTaskResponse shape, so the full result always comes via GET.
  let result = null;
  if (created?.taskId) {
    if (isTerminalStatus(created?.status)) {
      const first = await getTask(fetchImpl, baseUrl, tokenValue, created.taskId);
      if (first.httpStatus !== 200) {
        pushFailures([`GET after terminal POST failed (HTTP ${first.httpStatus})`]);
      } else {
        result = first.json;
      }
    } else {
      const polled = await pollForTerminal(
        fetchImpl,
        baseUrl,
        tokenValue,
        created.taskId,
        policy,
        tokenValue,
        { now, sleep: sleeper },
      );
      if (polled.error) {
        pushFailures([polled.error]);
      } else {
        result = polled.response.json;
      }
    }
  }
  outcome.status = result?.status ?? created?.status ?? null;
  summary.push(`status=${safeText(outcome.status, tokenValue)}`);

  // 3. Terminal-result invariant validation.
  if (created?.taskId) {
    pushFailures(assertTerminalResult(result, tokenValue));
  }

  // 4. Durable GET consistency check.
  if (created?.taskId) {
    const second = await getTask(fetchImpl, baseUrl, tokenValue, created.taskId);
    if (second.httpStatus !== 200) {
      pushFailures([`second GET failed (HTTP ${second.httpStatus})`]);
    } else {
      pushFailures(assertDurableConsistency(result, second.json));
    }
  }

  // 5. Exact replay (same requestId, byte-identical body) must resolve idempotently.
  if (created?.taskId) {
    const replay = await postTask(fetchImpl, baseUrl, tokenValue, body);
    pushFailures(
      assertExactReplay(
        { taskId: created.taskId, requestId: created.requestId },
        { ...replay.json, httpStatus: replay.httpStatus },
      ),
    );
    summary.push(`exactReplay=${replay.ok ? 'idempotent' : 'not-idempotent'}`);
  }

  // 6. Conflicting replay (same requestId, materially different payload) must fail closed.
  if (created?.taskId) {
    const conflict = await postTask(fetchImpl, baseUrl, tokenValue, buildConflictProbeBody(requestId));
    if (conflict.ok) {
      pushFailures(['conflicting replay was accepted instead of failing closed']);
    }
    pushFailures(assertConflictingReplayRejected(conflict, tokenValue));
    summary.push(
      `conflictingReplay=${isIdempotencyConflict(conflict, tokenValue) ? 'rejected' : 'not-rejected'}`,
    );
  }

  if (created?.taskId) summary.push(`taskId=${safeText(created.taskId, tokenValue)}`);

  outcome.ok = failures.length === 0;
  return outcome;
}

function serviceBaseUrl(env = process.env) {
  return requireEnv(ENV_VAR_BASE_URL, env).replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// Exports (static shape so cjs-module-lexer recognizes named ESM imports).
// ---------------------------------------------------------------------------

exports.OPERATOR_TASK_STATUSES = OPERATOR_TASK_STATUSES;
exports.TERMINAL_STATUSES = TERMINAL_STATUSES;
exports.SUCCESS_STATUS = SUCCESS_STATUS;
exports.IDEMPOTENCY_CONFLICT_CODE = IDEMPOTENCY_CONFLICT_CODE;
exports.CANONICAL_CAPABILITY_CODE = CANONICAL_CAPABILITY_CODE;
exports.CANONICAL_PROOF_PATH = CANONICAL_PROOF_PATH;
exports.CANONICAL_PROOF_TITLE = CANONICAL_PROOF_TITLE;
exports.CANONICAL_PROOF_SENTENCE = CANONICAL_PROOF_SENTENCE;
exports.CANONICAL_PROOF_CONTENT = CANONICAL_PROOF_CONTENT;
exports.ENV_VAR_BASE_URL = ENV_VAR_BASE_URL;
exports.ENV_VAR_TOKEN = ENV_VAR_TOKEN;
exports.HarnessError = HarnessError;
exports.ConfigurationError = ConfigurationError;
exports.buildCanonicalPrompt = buildCanonicalPrompt;
exports.buildCanonicalSubmitBody = buildCanonicalSubmitBody;
exports.buildConflictProbeBody = buildConflictProbeBody;
exports.requireEnv = requireEnv;
exports.redact = redact;
exports.safeText = safeText;
exports.isKnownStatus = isKnownStatus;
exports.isTerminalStatus = isTerminalStatus;
exports.pollPolicy = pollPolicy;
exports.deadlineAt = deadlineAt;
exports.isPastDeadline = isPastDeadline;
exports.assertChangedFiles = assertChangedFiles;
exports.patchContainsAddition = patchContainsAddition;
exports.assertPatchContent = assertPatchContent;
exports.assertWorkspaceCleaned = assertWorkspaceCleaned;
exports.findCredentialLeaks = findCredentialLeaks;
exports.assertNoCredentialLeakage = assertNoCredentialLeakage;
exports.assertTerminalResult = assertTerminalResult;
exports.assertDurableConsistency = assertDurableConsistency;
exports.assertExactReplay = assertExactReplay;
exports.isIdempotencyConflict = isIdempotencyConflict;
exports.assertConflictingReplayRejected = assertConflictingReplayRejected;
exports.postTask = postTask;
exports.getTask = getTask;
exports.run = run;
exports.serviceBaseUrl = serviceBaseUrl;