import assert from 'node:assert/strict';
import test from 'node:test';
import { VitoApiClient, type FetchImplementation } from '../lib/api/client.ts';

const TOKEN = 'header.payload.signature';

test('sends multipart payload without overriding the browser-generated content type boundary', async () => {
  let capturedInit: RequestInit | undefined;
  const fetchImplementation: FetchImplementation = async (_input, init) => {
    capturedInit = init;
    return Response.json({ ok: true });
  };
  const client = new VitoApiClient({ baseUrl: 'https://api.vito.example', accessToken: TOKEN, fetchImplementation });
  const formData = new FormData();
  formData.set('sourceType', 'DOCUMENT');
  formData.set('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));

  const result = await client.postFormData('/source-vault/upload', formData, (input) => input as { ok: boolean });
  const headers = new Headers(capturedInit?.headers);

  assert.deepEqual(result, { ok: true });
  assert.equal(capturedInit?.method, 'POST');
  assert.equal(capturedInit?.body, formData);
  assert.equal(headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(headers.get('content-type'), null);
  assert.equal(headers.get('x-organization-id'), null);
});
