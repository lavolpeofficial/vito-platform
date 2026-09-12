import { VitoApiError, mapHttpStatusToApiError } from './error.ts';

export type VitoApiPath = `/${string}`;
export type ResponseParser<T> = (input: unknown) => T | null;
export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type VitoApiClientOptions = Readonly<{
  baseUrl: string;
  accessToken?: string;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}>;

type RequestOptions = Readonly<{
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?: unknown;
}>;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_JSON_RESPONSE_BYTES = 5 * 1024 * 1024;
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export class VitoApiClient {
  private readonly baseUrl: URL;
  private readonly accessToken?: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(options: VitoApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.accessToken = validateAccessToken(options.accessToken);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  withAccessToken(accessToken: string): VitoApiClient {
    return new VitoApiClient({
      baseUrl: this.baseUrl.toString(),
      accessToken,
      fetchImplementation: this.fetchImplementation,
      timeoutMs: this.timeoutMs,
    });
  }

  get<T>(path: VitoApiPath, parser: ResponseParser<T>): Promise<T> {
    return this.request(path, { method: 'GET' }, parser);
  }

  post<T>(path: VitoApiPath, json: unknown, parser: ResponseParser<T>): Promise<T> {
    return this.request(path, { method: 'POST', json }, parser);
  }

  patch<T>(path: VitoApiPath, json: unknown, parser: ResponseParser<T>): Promise<T> {
    return this.request(path, { method: 'PATCH', json }, parser);
  }

  delete<T>(path: VitoApiPath, parser: ResponseParser<T>): Promise<T> {
    return this.request(path, { method: 'DELETE' }, parser);
  }

  private async request<T>(path: VitoApiPath, options: RequestOptions, parser: ResponseParser<T>): Promise<T> {
    const url = resolveApiUrl(this.baseUrl, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers({ Accept: 'application/json' });
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (options.json !== undefined) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: options.method,
        headers,
        body: options.json === undefined ? undefined : JSON.stringify(options.json),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof VitoApiError) throw error;
      throw new VitoApiError({
        status: 503,
        code: 'NETWORK_ERROR',
        message: controller.signal.aborted ? 'The VITO API request timed out.' : 'The VITO API is unreachable.',
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw await createResponseError(response);
    if (response.status === 204) {
      const parsed = parser(null);
      if (parsed !== null) return parsed;
      throw invalidResponse('The VITO API returned an unexpected empty response.');
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('application/json')) throw invalidResponse('The VITO API returned a non-JSON response.');
    const body = await readBoundedText(response);
    let decoded: unknown;
    try {
      decoded = JSON.parse(body) as unknown;
    } catch (error) {
      throw invalidResponse('The VITO API returned malformed JSON.', error);
    }
    const parsed = parser(decoded);
    if (parsed === null) throw invalidResponse('The VITO API response did not match the expected contract.');
    return parsed;
  }
}

export function buildApiPath(path: VitoApiPath, query: Readonly<Record<string, string | number | boolean | null | undefined>>): VitoApiPath {
  const url = new URL(path, 'https://vito.invalid');
  if (url.origin !== 'https://vito.invalid' || !path.startsWith('/') || path.startsWith('//')) throw invalidRequest('API paths must be origin-relative.');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}` as VitoApiPath;
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new VitoApiError({ status: 400, code: 'INVALID_REQUEST', message: 'The API base URL is invalid.', cause });
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw invalidRequest('The API base URL is unsafe.');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`;
  return url;
}

function resolveApiUrl(baseUrl: URL, path: VitoApiPath): URL {
  if (!path.startsWith('/') || path.startsWith('//')) throw invalidRequest('API paths must be origin-relative.');
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin) throw invalidRequest('Cross-origin API requests are not allowed.');
  return url;
}

function validateAccessToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > 16_384 || !JWT_PATTERN.test(value)) throw invalidRequest('The API access token is malformed.');
  return value;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > MAX_TIMEOUT_MS) throw invalidRequest('The API timeout is outside the supported range.');
  return timeout;
}

async function createResponseError(response: Response): Promise<VitoApiError> {
  const mapped = mapHttpStatusToApiError(response.status);
  const issues = await readErrorIssues(response);
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
  return new VitoApiError({
    status: response.status,
    code: mapped.code,
    message: mapped.message,
    issues,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
  });
}

async function readErrorIssues(response: Response): Promise<readonly string[]> {
  try {
    const body = await readBoundedText(response);
    const decoded = JSON.parse(body) as unknown;
    if (typeof decoded !== 'object' || decoded === null || !('message' in decoded)) return [];
    const message = (decoded as { message?: unknown }).message;
    const values = Array.isArray(message) ? message : [message];
    return values.filter((value): value is string => typeof value === 'string').slice(0, 10).map((value) => value.slice(0, 300));
  } catch {
    return [];
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_RESPONSE_BYTES) throw invalidResponse('The VITO API response exceeded the size limit.');
  const body = await response.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_JSON_RESPONSE_BYTES) throw invalidResponse('The VITO API response exceeded the size limit.');
  return body;
}

function invalidRequest(message: string): VitoApiError {
  return new VitoApiError({ status: 400, code: 'INVALID_REQUEST', message });
}

function invalidResponse(message: string, cause?: unknown): VitoApiError {
  return new VitoApiError({ status: 502, code: 'INVALID_RESPONSE', message, cause });
}
