export type VitoApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE';

export class VitoApiError extends Error {
  readonly status: number;
  readonly code: VitoApiErrorCode;
  readonly issues: readonly string[];
  readonly retryAfterSeconds: number | null;

  constructor(input: Readonly<{
    message: string;
    status: number;
    code: VitoApiErrorCode;
    issues?: readonly string[];
    retryAfterSeconds?: number | null;
    cause?: unknown;
  }>) {
    super(input.message, { cause: input.cause });
    this.name = 'VitoApiError';
    this.status = input.status;
    this.code = input.code;
    this.issues = Object.freeze([...(input.issues ?? [])]);
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof VitoApiError && error.code === 'UNAUTHENTICATED';
}

export function mapHttpStatusToApiError(status: number): Readonly<{ code: VitoApiErrorCode; message: string }> {
  if (status === 400 || status === 422) return { code: 'INVALID_REQUEST', message: 'The VITO API rejected the request.' };
  if (status === 401) return { code: 'UNAUTHENTICATED', message: 'The VITO session is no longer valid.' };
  if (status === 403) return { code: 'FORBIDDEN', message: 'The current role is not permitted to perform this action.' };
  if (status === 404) return { code: 'NOT_FOUND', message: 'The requested VITO resource was not found.' };
  if (status === 409) return { code: 'CONFLICT', message: 'The VITO request conflicts with the current resource state.' };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'The VITO API rate limit has been reached.' };
  return { code: 'UPSTREAM_ERROR', message: 'The VITO API could not complete the request.' };
}
