import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { OperatorTaskStatus } from '@vito/contracts';
import {
  OPERATOR_TASK_STATUSES,
  TERMINAL_STATUSES,
  SUCCESS_STATUS,
  IDEMPOTENCY_CONFLICT_CODE,
  CANONICAL_PROOF_PATH,
  CANONICAL_PROOF_TITLE,
  CANONICAL_PROOF_SENTENCE,
  CANONICAL_CAPABILITY_CODE,
  ENV_VAR_BASE_URL,
  ENV_VAR_TOKEN,
  buildCanonicalPrompt,
  buildCanonicalSubmitBody,
  buildConflictProbeBody,
  requireEnv,
  safeText,
  pollPolicy,
  deadlineAt,
  isPastDeadline,
  isKnownStatus,
  isTerminalStatus,
  assertChangedFiles,
  assertPatchContent,
  assertWorkspaceCleaned,
  assertNoCredentialLeakage,
  assertTerminalResult,
  assertDurableConsistency,
  assertExactReplay,
  isIdempotencyConflict,
  assertConflictingReplayRejected,
  postTask,
  run,
} from '../../../../../scripts/operator-bridge-real-flow.js';

const HARNESS_SCRIPT = path.resolve(
  __dirname,
  '../../../../../scripts/operator-bridge-real-flow.mjs',
);

const TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcGVyYXRvciIsIm9yZ19pZCI6Im9yZy0xIiwicm9sZSI6Ik1FTUJFUiIsInRva2VuX3ZlcnNpb24iOjF9.test-signature';

const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const TASK_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const PATCH = `diff --git a/${CANONICAL_PROOF_PATH} b/${CANONICAL_PROOF_PATH}
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/${CANONICAL_PROOF_PATH}
@@ -0,0 +1,3 @@
+# Operator Bridge Real Flow Proof
+
+This file was created by a governed VITO operator task.
`;

const FAST_POLL = { policy: { intervalMs: 1, maxWaitMs: 5000 }, sleep: async () => undefined };

interface JsonResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
}

type FetchHandler = (url: string, method: string, body: unknown) => { status: number; json: unknown };

function jsonResponse(status: number, json: unknown): JsonResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => json };
}

function makeFetch(handler: FetchHandler, calls: FetchCall[] = []) {
  return async (url: string, init?: { method?: string; body?: string }): Promise<JsonResponse> => {
    let body: unknown = undefined;
    if (init?.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method: init?.method ?? 'GET', body });
    const handled = handler(url, init?.method ?? 'GET', body);
    return jsonResponse(handled.status, handled.json);
  };
}

function fullResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: TASK_ID,
    requestId: REQUEST_ID,
    status: SUCCESS_STATUS,
    correlationId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    workflowRunId: 'cccccccc-dddd-4eee-8fff-000000000000',
    workflowStepRunId: 'dddddddd-eeee-4fff-8001-111111111111',
    invocationId: 'eeeeeeee-ffff-4001-8001-222222222222',
    executionId: 'ffffffff-0001-4001-8001-333333333333',
    provider: { providerCode: 'opencode-local', displayName: 'OpenCode Local' },
    capabilityCode: CANONICAL_CAPABILITY_CODE,
    prompt: 'operator prompt',
    stdout: 'Completed.',
    stderr: '',
    changedFiles: [CANONICAL_PROOF_PATH],
    patch: PATCH,
    workspaceDisposition: 'CLEANED',
    reviewRequired: false,
    sensitivePayloadAvailable: true,
    sensitivePayloadExpiresAt: '2099-01-01T00:00:00.000Z',
    sensitivePayloadDeletedAt: null,
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:01.000Z',
    ...overrides,
  };
}

function bridgeFetchHandler(
  overrides: { postStatus?: string; getResult?: () => Record<string, unknown> } = {},
): FetchHandler {
  let postStatus = overrides.postStatus ?? 'DISPATCHING';
  const getResult = overrides.getResult ?? (() => fullResult());
  return (url, method, body) => {
    if (method === 'POST' && /\/v1\/operator\/tasks$/.test(url)) {
      const payload = (body ?? {}) as Record<string, unknown>;
      if (payload.prompt === buildConflictProbeBody(String(payload.requestId ?? '')).prompt) {
        return {
          status: 409,
          json: {
            statusCode: 409,
            error: 'Conflict',
            message: IDEMPOTENCY_CONFLICT_CODE,
            path: url,
            timestamp: 'now',
          },
        };
      }
      if (payload.prompt === buildCanonicalPrompt()) {
        return {
          status: 200,
          json: {
            taskId: TASK_ID,
            requestId: payload.requestId,
            correlationId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
            status: postStatus,
            routingDecisionId: null,
          },
        };
      }
      return { status: 400, json: { statusCode: 400, message: ['unexpected payload'] } };
    }
    if (method === 'GET' && /\/v1\/operator\/tasks\/[^/]+$/.test(url)) {
      if (postStatus === 'DISPATCHING') {
        postStatus = SUCCESS_STATUS;
      }
      return { status: 200, json: getResult() };
    }
    return { status: 404, json: { message: 'unknown route' } };
  };
}

describe('operator-bridge-real-flow harness', () => {
  describe('authoritative OperatorTaskStatus contract', () => {
    it('mirrors the @vito/contracts status enum without drift', () => {
      expect(OPERATOR_TASK_STATUSES).toEqual(Object.values(OperatorTaskStatus));
    });

    it('treats only the contract terminal statuses as terminal', () => {
      expect(TERMINAL_STATUSES).toEqual(new Set(['COMPLETED', 'HUMAN_GATE', 'FAILED']));
      expect(SUCCESS_STATUS).toBe(OperatorTaskStatus.COMPLETED);
      for (const status of Object.values(OperatorTaskStatus)) {
        expect(isKnownStatus(status)).toBe(true);
      }
      expect(isTerminalStatus(OperatorTaskStatus.DISPATCHING)).toBe(false);
      expect(isTerminalStatus(OperatorTaskStatus.COMPLETED)).toBe(true);
    });

    it('fails closed on unknown statuses', () => {
      expect(isKnownStatus('RUNNING')).toBe(false);
      expect(isKnownStatus(undefined)).toBe(false);
    });
  });

  describe('required environment validation', () => {
    it('rejects a missing variable', () => {
      expect(() => requireEnv(ENV_VAR_TOKEN, {})).toThrow(ConfigurationErrorMessage(ENV_VAR_TOKEN));
      expect(() => requireEnv(ENV_VAR_BASE_URL, {})).toThrow(ConfigurationErrorMessage(ENV_VAR_BASE_URL));
    });

    it('rejects blank values', () => {
      expect(() => requireEnv(ENV_VAR_TOKEN, { [ENV_VAR_TOKEN]: '   ' })).toThrow(
        ConfigurationErrorMessage(ENV_VAR_TOKEN),
      );
    });

    it('accepts a present non-blank value', () => {
      expect(requireEnv(ENV_VAR_TOKEN, { [ENV_VAR_TOKEN]: TOKEN })).toBe(TOKEN);
    });

    it('run fails closed when credentials are missing', async () => {
      await expect(run({ env: {} })).rejects.toThrow(ConfigurationErrorMessage(ENV_VAR_TOKEN));
      await expect(
        run({ env: { [ENV_VAR_TOKEN]: TOKEN } }),
      ).rejects.toThrow(ConfigurationErrorMessage(ENV_VAR_BASE_URL));
    });
  });

  describe('credential redaction', () => {
    it('never lets the token survive formatted text', () => {
      const text = `config secret ${TOKEN} and again ${TOKEN}`;
      const safe = safeText(text, TOKEN);
      expect(safe).not.toContain(TOKEN);
      expect(safe.split('[REDACTED]').length).toBeGreaterThan(1);
    });

    it('redacts JWT-shaped material even without the exact token', () => {
      const otherJwt = TOKEN.replace('test-signature', 'other-signature');
      const safe = safeText(`Authorization: Bearer ${otherJwt}`, TOKEN);
      expect(safe).not.toContain(otherJwt);
      expect(safe).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    });

    it('builds redaction into transport errors', async () => {
      const failingFetch = async () => {
        throw new Error(`connection refused with ${TOKEN}`);
      };
      await expect(
        postTask(
          failingFetch as never,
          'http://127.0.0.1:1',
          TOKEN,
          buildCanonicalSubmitBody(REQUEST_ID),
        ),
      ).rejects.toThrow(/transport error/);
      try {
        await postTask(
          failingFetch as never,
          'http://127.0.0.1:1',
          TOKEN,
          buildCanonicalSubmitBody(REQUEST_ID),
        );
      } catch (error) {
        expect(String((error as Error).message)).not.toContain(TOKEN);
      }
    });
  });

  describe('bounded polling timeout behavior', () => {
    it('computes a bounded deadline from the policy', () => {
      const policy = pollPolicy({ intervalMs: 1000, maxWaitMs: 60_000 });
      expect(policy).toEqual({ intervalMs: 1000, maxWaitMs: 60_000 });
      expect(deadlineAt(500, policy)).toBe(60_500);
      expect(isPastDeadline(60_499, 60_500)).toBe(false);
      expect(isPastDeadline(60_500, 60_500)).toBe(true);
    });

    it('rejects non-positive bounds fail-closed', () => {
      expect(() => pollPolicy({ intervalMs: 0 })).toThrow();
      expect(() => pollPolicy({ maxWaitMs: -1 })).toThrow();
    });

    it('stops and fails when the poll deadline passes', async () => {
      const calls: FetchCall[] = [];
      const fetchImpl = makeFetch(
        (url, method) => {
          if (method === 'POST') {
            return {
              status: 200,
              json: { taskId: TASK_ID, requestId: REQUEST_ID, correlationId: 'c-1', status: 'DISPATCHING', routingDecisionId: null },
            };
          }
          return { status: 200, json: { status: 'DISPATCHING' } };
        },
        calls,
      );
      let tick = 0;
      const now = () => (tick += 30);
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl,
        policy: { intervalMs: 25, maxWaitMs: 100 },
        now,
        sleep: async () => undefined,
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('before the poll deadline');
      const getCalls = calls.filter((c) => c.method === 'GET');
      expect(getCalls.length).toBeGreaterThan(0);
      expect(getCalls.length).toBeLessThan(10);
    });

    it('fails closed on an unknown status returned by the service', async () => {
      const fetchImpl = makeFetch((url, method) =>
        method === 'POST'
          ? { status: 200, json: { taskId: TASK_ID, requestId: REQUEST_ID, correlationId: 'c-1', status: 'DISPATCHING', routingDecisionId: null } }
          : { status: 200, json: { status: 'RUNNING' } },
      );
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl,
        policy: { intervalMs: 1000, maxWaitMs: 1000 },
        now: () => 0,
        sleep: async () => undefined,
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('unexpected task status');
    });
  });

  describe('result invariant helpers', () => {
    it('changedFiles must be exactly the canonical proof path', () => {
      expect(assertChangedFiles([CANONICAL_PROOF_PATH])).toEqual([]);
      expect(assertChangedFiles([CANONICAL_PROOF_PATH, 'docs/other.md']).length).toBeGreaterThan(0);
      expect(
        assertChangedFiles(['docs/other.md']).join('\n'),
      ).toContain('unexpected changed file');
      expect(assertChangedFiles(undefined).length).toBeGreaterThan(0);
    });

    it('patch must be non-empty and contain the intended addition', () => {
      expect(assertPatchContent(PATCH)).toEqual([]);
      expect(assertPatchContent('').join('\n')).toContain('empty or missing');
      expect(assertPatchContent(null).length).toBeGreaterThan(0);
      expect(assertPatchContent('diff --git a/x b/x\n+something else').join('\n')).toContain(
        'does not contain the intended proof',
      );
    });

    it('workspace disposition must be CLEANED', () => {
      expect(assertWorkspaceCleaned('CLEANED')).toEqual([]);
      expect(assertWorkspaceCleaned(undefined).length).toBeGreaterThan(0);
      expect(assertWorkspaceCleaned('PRESERVED').join('\n')).toContain('not CLEANED');
    });

    it('detects obvious credential leakage in result payloads', () => {
      expect(assertNoCredentialLeakage(fullResult(), TOKEN)).toEqual([]);
      const leaks = assertNoCredentialLeakage(fullResult({ stdout: `token ${TOKEN}` }), TOKEN);
      expect(leaks.join('\n')).toContain('stdout leaks');
      const leaked = assertNoCredentialLeakage(
        fullResult({ patch: 'diff --git\n+AKIA0123456789ABCDEF' }),
        TOKEN,
      );
      expect(leaked.join('\n')).toContain('patch leaks');
    });

    it('terminal result validation accepts a bound-result and rejects violations', () => {
      expect(assertTerminalResult(fullResult(), TOKEN)).toEqual([]);
      expect(assertTerminalResult(fullResult({ status: 'DISPATCHING' }), TOKEN).length).toBeGreaterThan(0);
      expect(assertTerminalResult(fullResult({ status: 'FAILED' }), TOKEN).join('\n')).toContain(
        'task reached FAILED',
      );
      expect(
        assertTerminalResult(fullResult({ changedFiles: ['docs/unexpected.md'] }), TOKEN).join('\n'),
      ).toContain('unexpected changed file');
      expect(assertTerminalResult(fullResult({ patch: '' }), TOKEN).join('\n')).toContain(
        'empty or missing',
      );
      expect(
        assertTerminalResult(fullResult({ workspaceDisposition: undefined }), TOKEN).join('\n'),
      ).toContain('not CLEANED');
      expect(
        assertTerminalResult(fullResult({ sensitivePayloadAvailable: false }), TOKEN).join('\n'),
      ).toContain('expired');
      expect(
        assertTerminalResult(fullResult({ provider: undefined }), TOKEN).join('\n'),
      ).toContain('routed real provider');
      expect(
        assertTerminalResult(fullResult({ stdout: `probe ${TOKEN}` }), TOKEN).join('\n'),
      ).toContain('stdout leaks');
    });

    it('durable GET consistency compares stable identity/result metadata', () => {
      const first = fullResult();
      expect(assertDurableConsistency(first, fullResult())).toEqual([]);
      expect(assertDurableConsistency(first, fullResult({ taskId: 'other' }))[0]).toContain('taskId');
      expect(assertDurableConsistency(first, fullResult({ changedFiles: ['x.md'] })).join('\n')).toContain(
        'changedFiles',
      );
      expect(assertDurableConsistency(first, fullResult({ patch: 'different patch' })).join('\n')).toContain(
        'patch',
      );
    });

    it('exact replay must resolve idempotently to the same task identity', () => {
      const original = { taskId: TASK_ID, requestId: REQUEST_ID };
      expect(
        assertExactReplay(original, { httpStatus: 200, taskId: TASK_ID, requestId: REQUEST_ID }),
      ).toEqual([]);
      expect(
        assertExactReplay(original, { httpStatus: 200, taskId: 'other', requestId: REQUEST_ID }).join('\n'),
      ).toContain('different taskId');
      expect(
        assertExactReplay(original, { httpStatus: 409, taskId: TASK_ID, requestId: REQUEST_ID }).join('\n'),
      ).toContain('not accepted idempotently');
    });

    it('conflicting replay must fail closed with the idempotency conflict contract', () => {
      const conflict = {
        httpStatus: 409,
        ok: false,
        json: { statusCode: 409, error: 'Conflict', message: IDEMPOTENCY_CONFLICT_CODE },
      };
      expect(isIdempotencyConflict(conflict, TOKEN)).toBe(true);
      expect(assertConflictingReplayRejected(conflict, TOKEN)).toEqual([]);
      expect(
        assertConflictingReplayRejected({ httpStatus: 200, ok: true, json: {} }, TOKEN).length,
      ).toBeGreaterThan(0);
      expect(
        assertConflictingReplayRejected(
          { httpStatus: 500, ok: false, json: { message: `internal ${TOKEN} failure` } },
          TOKEN,
        ).join('\n'),
      ).not.toContain(TOKEN);
    });
  });

  describe('run() operator flow', () => {
    it('passes the full positive roundtrip via GET polling', async () => {
      const calls: FetchCall[] = [];
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(bridgeFetchHandler({ postStatus: 'DISPATCHING' }), calls),
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.failures).toEqual([]);
      expect(outcome.taskId).toBe(TASK_ID);
      expect(outcome.status).toBe(SUCCESS_STATUS);
      expect(outcome.summary.join('\n')).toContain('exactReplay=idempotent');
      expect(outcome.summary.join('\n')).toContain('conflictingReplay=rejected');
      expect(outcome.summary.join('\n')).not.toContain(TOKEN);

      const postBodies = calls
        .filter((c) => c.method === 'POST')
        .map((c) => c.body as Record<string, unknown>);
      expect(postBodies).toHaveLength(3);
      expect(postBodies[0].requestId).toBe(REQUEST_ID);
      expect(JSON.stringify(postBodies[0])).toBe(JSON.stringify(postBodies[1]));
      expect(postBodies[2].prompt).not.toBe(postBodies[0].prompt);
    });

    it('passes when POST already returns a terminal status and the full result comes via GET', async () => {
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(bridgeFetchHandler({ postStatus: 'COMPLETED' })),
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.status).toBe(SUCCESS_STATUS);
    });

    it('rejects unrelated changed files with a non-zero result', async () => {
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(bridgeFetchHandler({ getResult: () => fullResult({ changedFiles: [CANONICAL_PROOF_PATH, 'docs/extra.md'] }) })),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('expected exactly one changed file');
    });

    it('rejects a missing governed patch when payload is retained', async () => {
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(bridgeFetchHandler({ getResult: () => fullResult({ patch: null }) })),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('governed patch is empty or missing');
    });

    it('rejects a non-CLEANED workspace', async () => {
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(bridgeFetchHandler({ getResult: () => fullResult({ workspaceDisposition: undefined }) })),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('workspace is not CLEANED');
    });

    it('rejects a failing terminal status', async () => {
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(
          bridgeFetchHandler({
            getResult: () =>
              fullResult({
                status: 'FAILED',
                error: { reason: 'OPERATOR_DISPATCH_FAILED', message: 'provider exploded', retryable: false },
              }),
          }),
        ),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('task reached FAILED');
    });

    it('rejects credential leakage in stdout and never surfaces the token', async () => {
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(bridgeFetchHandler({ getResult: () => fullResult({ stdout: `secret ${TOKEN}` }) })),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('stdout leaks');
      expect(outcome.failures.join('\n')).not.toContain(TOKEN);
      expect(outcome.summary.join('\n')).not.toContain(TOKEN);
    });

    it('detects a second GET that diverges from the first', async () => {
      let getCount = 0;
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(
          bridgeFetchHandler({
            getResult: () => {
              getCount += 1;
              if (getCount <= 1) return fullResult();
              return fullResult({ workflowRunId: 'other-workflow-run' });
            },
          }),
        ),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('second GET changed workflowRunId');
    });

    it('rejects an idempotency conflict that is not the fail-closed contract', async () => {
      const handler: FetchHandler = (url, method, body) => {
        if (method === 'POST') {
          const payload = (body ?? {}) as Record<string, unknown>;
          if (payload.requestId === REQUEST_ID && payload.prompt !== buildCanonicalPrompt()) {
            return {
              status: 409,
              json: { statusCode: 409, error: 'Conflict', message: 'SOME_OTHER_CONFLICT' },
            };
          }
          return {
            status: 200,
            json: { taskId: TASK_ID, requestId: payload.requestId, correlationId: 'c-1', status: 'DISPATCHING', routingDecisionId: null },
          };
        }
        return { status: 200, json: fullResult() };
      };
      const outcome = await run({
        env: { [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1', [ENV_VAR_TOKEN]: TOKEN },
        requestId: REQUEST_ID,
        ...FAST_POLL,
        fetchImpl: makeFetch(handler),
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.failures.join('\n')).toContain('did not fail closed');
    });
  });

  describe('CLI entry', () => {
    it('exits non-zero with usage guidance and no token for missing credentials', async () => {
      const env: NodeJS.ProcessEnv = { ...process.env, [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1' };
      delete env[ENV_VAR_TOKEN];
      const result = await runHarnessScript([], env);
      expect(result.status).toBe(2);
      const allOutput = `${result.stdout}\n${result.stderr}`;
      expect(allOutput).toContain(ENV_VAR_TOKEN);
      expect(allOutput).not.toContain(TOKEN);
    });

    it('rejects CLI options fail-closed', async () => {
      const result = await runHarnessScript(['--option'], {
        [ENV_VAR_BASE_URL]: 'http://127.0.0.1:1',
        [ENV_VAR_TOKEN]: TOKEN,
      });
      expect(result.status).toBe(2);
      const allOutput = `${result.stdout}\n${result.stderr}`;
      expect(allOutput).toContain('No CLI options are accepted');
      expect(allOutput).not.toContain(TOKEN);
    });

    it('passes the real HTTP roundtrip and reports a sanitized PASS', async () => {
      const { baseUrl, close } = await startMockVitoServer({ postStatus: 'COMPLETED' });
      try {
        const result = await runHarnessScript([], {
          [ENV_VAR_BASE_URL]: baseUrl,
          [ENV_VAR_TOKEN]: TOKEN,
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('RESULT: PASS');
        const allOutput = `${result.stdout}\n${result.stderr}`;
        expect(allOutput).not.toContain(TOKEN);
        expect(allOutput).toContain('conflictingReplay=rejected');
      } finally {
        await close();
      }
    }, 15000);

    it('fails over HTTP with a non-zero exit and never prints the token', async () => {
      const { baseUrl, close } = await startMockVitoServer({
        postStatus: 'DISPATCHING',
        leak: `leaked ${TOKEN}`,
      });
      try {
        const result = await runHarnessScript([], {
          [ENV_VAR_BASE_URL]: baseUrl,
          [ENV_VAR_TOKEN]: TOKEN,
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain('RESULT: FAIL');
        expect(result.stdout).toContain('stdout leaks');
        const allOutput = `${result.stdout}\n${result.stderr}`;
        expect(allOutput).not.toContain(TOKEN);
      } finally {
        await close();
      }
    }, 15000);
  });
});

function ConfigurationErrorMessage(name: string) {
  return `Missing required environment variable: ${name}`;
}

function runHarnessScript(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARNESS_SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ status: code, stdout, stderr }));
  });
}

function startMockVitoServer(options: { postStatus?: string; leak?: string } = {}) {
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    let lastRequestId: string | null = null;
    let getCount = 0;
    const server = http.createServer((req, res) => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'POST' && req.url === '/v1/operator/tasks') {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            body = {};
          }
          const requestId = String(body.requestId ?? '');
          if (body.prompt === buildConflictProbeBody(requestId).prompt) {
            send(409, {
              statusCode: 409,
              error: 'Conflict',
              message: IDEMPOTENCY_CONFLICT_CODE,
              path: req.url,
              timestamp: 'now',
            });
            return;
          }
          if (body.prompt === buildCanonicalPrompt()) {
            lastRequestId = requestId;
            send(200, {
              taskId: TASK_ID,
              requestId,
              correlationId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
              status: options.postStatus ?? 'DISPATCHING',
              routingDecisionId: null,
            });
            return;
          }
          send(400, { statusCode: 400, error: 'Bad Request', message: ['unexpected payload'] });
        });
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/v1/operator/tasks/')) {
        getCount += 1;
        const result = fullResult({
          requestId: lastRequestId ?? REQUEST_ID,
          ...(getCount === 1 ? { status: options.postStatus === 'DISPATCHING' ? 'DISPATCHING' : SUCCESS_STATUS } : {}),
          ...(options.leak ? { stdout: options.leak } : {}),
        });
        send(200, result);
        return;
      }
      send(404, { message: 'unknown route' });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((res) => {
            server.closeAllConnections?.();
            server.close(() => res());
          }),
      });
    });
  });
}