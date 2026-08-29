// Ambient declarations for scripts/operator-bridge-real-flow.js (CommonJS).
// The harness CLI entry is scripts/operator-bridge-real-flow.mjs; this file
// gives TypeScript consumers (tests) a typed view of the exported helpers.

export type OperatorTaskJson = Record<string, unknown>;

export interface HttpResponse {
  httpStatus: number;
  ok: boolean;
  json: OperatorTaskJson | null;
}

export interface HarnessFetchRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type HarnessFetch = (
  url: string,
  init?: HarnessFetchRequest,
) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

export interface RunOutcome {
  ok: boolean;
  requestId: string;
  taskId: string | null;
  status: string | null;
  failures: string[];
  summary: string[];
}

export interface HarnessBudget {
  maxDurationMs?: number;
  maxTokens?: number;
  maxCostMinorUnits?: number;
}

export interface HarnessConfig {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: HarnessFetch;
  policy?: { intervalMs?: number; maxWaitMs?: number };
  budget?: HarnessBudget;
  requestId?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}

export interface PollPolicy {
  intervalMs: number;
  maxWaitMs: number;
}

export const OPERATOR_TASK_STATUSES: readonly string[];
export const TERMINAL_STATUSES: ReadonlySet<string>;
export const SUCCESS_STATUS: string;
export const IDEMPOTENCY_CONFLICT_CODE: string;
export const CANONICAL_CAPABILITY_CODE: string;
export const CANONICAL_PROOF_PATH: string;
export const CANONICAL_PROOF_TITLE: string;
export const CANONICAL_PROOF_SENTENCE: string;
export const CANONICAL_PROOF_CONTENT: string;
export const ENV_VAR_BASE_URL: string;
export const ENV_VAR_TOKEN: string;

export function buildCanonicalPrompt(): string;
export function buildCanonicalSubmitBody(requestId: string, budget?: HarnessBudget): Record<string, unknown>;
export function buildConflictProbeBody(requestId: string): Record<string, unknown>;

export class HarnessError extends Error {}
export class ConfigurationError extends HarnessError {}

export function requireEnv(name: string, env?: NodeJS.ProcessEnv): string;
export function redact(text: unknown, token: string): string;
export function safeText(value: unknown, token: string): string;

export function isKnownStatus(status: unknown): boolean;
export function isTerminalStatus(status: unknown): boolean;
export function pollPolicy(options?: { intervalMs?: number; maxWaitMs?: number }): PollPolicy;
export function deadlineAt(startMs: number, policy: PollPolicy): number;
export function isPastDeadline(nowMs: number, deadlineMs: number): boolean;

export function assertChangedFiles(changedFiles: unknown): string[];
export function patchContainsAddition(patch: unknown, text: string): boolean;
export function assertPatchContent(patch: unknown): string[];
export function assertWorkspaceCleaned(disposition: unknown): string[];
export function findCredentialLeaks(text: unknown, token: string): string[];
export function assertNoCredentialLeakage(result: OperatorTaskJson | null, token: string): string[];
export function assertTerminalResult(result: OperatorTaskJson | null, token: string): string[];
export function assertDurableConsistency(first: OperatorTaskJson, second: OperatorTaskJson): string[];
export function assertExactReplay(original: OperatorTaskJson, replay: OperatorTaskJson): string[];
export function isIdempotencyConflict(response: HttpResponse, token: string): boolean;
export function assertConflictingReplayRejected(response: HttpResponse, token: string): string[];

export function postTask(
  fetchImpl: HarnessFetch,
  baseUrl: string,
  token: string,
  body: Record<string, unknown>,
): Promise<HttpResponse>;
export function getTask(
  fetchImpl: HarnessFetch,
  baseUrl: string,
  token: string,
  taskId: string,
): Promise<HttpResponse>;

export function run(config?: HarnessConfig): Promise<RunOutcome>;
export function serviceBaseUrl(env?: NodeJS.ProcessEnv): string;