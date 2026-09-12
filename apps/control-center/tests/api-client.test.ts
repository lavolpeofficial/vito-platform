import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApiPath, VitoApiClient, type FetchImplementation } from '../lib/api/client.ts';
import { VitoApiError } from '../lib/api/error.ts';

const TOKEN = 'header.payload.signature';

test('sends authenticated JSON requests without a client-controlled tenant header', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetchImplementation: FetchImplementation = async (input, init) => {
    capturedUrl = input.toString();
    capturedInit = init;
    return Response.json({ state: 'ready' });
  };
  const client = new VitoApiClient({ baseUrl: 'https://api.vito.example', accessToken: TOKEN, fetchImplementation });

  const result = await client.post('/operations/summary', { scope: 'current' }, (input) => input as { state: string });
  const headers = new Headers(capturedInit?.headers);
  assert.deepEqual(result, { state: 'ready' });
  assert.equal(capturedUrl, 'https://api.vito.example/operations/summary');
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.body, JSON.stringify({ scope: 'current' }));
  assert.equal(capturedInit?.cache, 'no-store');
  assert.equal(capturedInit?.redirect, 'error');
  assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(headers.get('x-organization-id'), null);
});

test('rejects cross-origin paths and unsafe API origins before transport', async () => {
  assert.throws(() => new VitoApiClient({ baseUrl: 'https://user:secret@api.vito.example' }), (error) => error instanceof VitoApiError && error.code === 'INVALID_REQUEST');
  const client = new VitoApiClient({ baseUrl: 'https://api.vito.example' });
  await assert.rejects(client.get('//attacker.example/data' as `/${string}`, () => true), (error) => error instanceof VitoApiError && error.code === 'INVALID_REQUEST');
});

test('maps HTTP failures to stable errors and bounds upstream validation details', async () => {
  const client = new VitoApiClient({
    baseUrl: 'https://api.vito.example',
    fetchImplementation: async () => Response.json({ message: ['field is invalid', 42, 'second issue'] }, { status: 400 }),
  });
  await assert.rejects(client.get('/tasks', () => true), (error) => {
    assert.ok(error instanceof VitoApiError);
    assert.equal(error.code, 'INVALID_REQUEST');
    assert.equal(error.status, 400);
    assert.deepEqual(error.issues, ['field is invalid', 'second issue']);
    assert.equal(error.retryAfterSeconds, null);
    return true;
  });
});

test('fails closed when a success response violates its declared contract', async () => {
  const client = new VitoApiClient({ baseUrl: 'https://api.vito.example', fetchImplementation: async () => Response.json({ unexpected: true }) });
  await assert.rejects(client.get('/operations/summary', () => null), (error) => error instanceof VitoApiError && error.code === 'INVALID_RESPONSE');
});

test('builds encoded query paths without accepting a foreign origin', () => {
  assert.equal(buildApiPath('/users', { take: 20, includeDisabled: false, status: null }), '/users?take=20&includeDisabled=false');
  assert.throws(() => buildApiPath('//attacker.example' as `/${string}`, {}), (error) => error instanceof VitoApiError && error.code === 'INVALID_REQUEST');
});

test('aborts transport at the configured bounded timeout', async () => {
  const fetchImplementation: FetchImplementation = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
  const client = new VitoApiClient({ baseUrl: 'https://api.vito.example', fetchImplementation, timeoutMs: 100 });
  await assert.rejects(client.get('/health', () => true), (error) => error instanceof VitoApiError && error.code === 'NETWORK_ERROR' && /timed out/.test(error.message));
});
