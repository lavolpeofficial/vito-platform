import assert from 'node:assert/strict';
import test from 'node:test';
import { getVitoApiBaseUrl } from '../lib/api/config.ts';
import { parseJwtIdentifiers, parseLoginCredentials, parseOrganization, parseSessionLifetime } from '../lib/auth/contracts.ts';
import { isSameOriginMutation, publicAuthError } from '../lib/auth/request.ts';

test('validates login input without normalizing passwords', () => {
  assert.deepEqual(parseLoginCredentials({ email: ' owner@example.com ', password: '  secret  ', organizationSlug: 'la-volpe' }), {
    email: 'owner@example.com', password: '  secret  ', organizationSlug: 'la-volpe',
  });
  assert.equal(parseLoginCredentials({ email: 'owner@example.com', password: 'secret', organizationSlug: '../other' }), null);
});

test('accepts only bounded backend token lifetimes', () => {
  assert.equal(parseSessionLifetime('15m'), 900);
  assert.equal(parseSessionLifetime('1h'), 3600);
  assert.equal(parseSessionLifetime('30s'), null);
  assert.equal(parseSessionLifetime('7d'), null);
});

test('extracts only valid tenant identifiers from an untrusted JWT payload', () => {
  const payload = Buffer.from(JSON.stringify({ sub: '0f9b1dd9-62b4-4d3e-9fb2-615823a49255', org_id: '7c54248f-1cc0-44ed-af36-0c499cb4a222' })).toString('base64url');
  assert.deepEqual(parseJwtIdentifiers(`header.${payload}.signature`), { userId: '0f9b1dd9-62b4-4d3e-9fb2-615823a49255', organizationId: '7c54248f-1cc0-44ed-af36-0c499cb4a222' });
  assert.equal(parseJwtIdentifiers('not-a-jwt'), null);
});

test('requires an active, well-formed organization and keeps auth errors generic', () => {
  const organization = { id: '7c54248f-1cc0-44ed-af36-0c499cb4a222', name: 'LA VOLPE', slug: 'la-volpe', status: 'ACTIVE' };
  assert.deepEqual(parseOrganization(organization), { id: organization.id, name: 'LA VOLPE', slug: 'la-volpe' });
  assert.equal(parseOrganization({ ...organization, status: 'SUSPENDED' }), null);
  assert.deepEqual(publicAuthError(401), { status: 401, message: 'Invalid credentials.' });
  assert.equal(publicAuthError(500).status, 502);
});

test('fails closed on an absent production API origin and rejects credential-bearing URLs', () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnv = environment.NODE_ENV;
  const previousApiUrl = environment.VITO_API_BASE_URL;
  try {
    environment.NODE_ENV = 'production';
    delete environment.VITO_API_BASE_URL;
    assert.throws(() => getVitoApiBaseUrl(), /must be configured/);
    environment.VITO_API_BASE_URL = 'https://user:secret@example.com';
    assert.throws(() => getVitoApiBaseUrl(), /without credentials/);
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
    if (previousApiUrl === undefined) delete environment.VITO_API_BASE_URL;
    else environment.VITO_API_BASE_URL = previousApiUrl;
  }
});

test('rejects cross-origin mutations when a browser Origin header is present', () => {
  const request = {
    headers: new Headers({ origin: 'https://attacker.example' }),
    nextUrl: new URL('https://control.vito.example/api/auth/logout'),
  };
  assert.equal(isSameOriginMutation(request as never), false);
});

test('accepts only the explicitly configured reverse-proxy public origin', () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.VITO_CONTROL_CENTER_PUBLIC_ORIGIN;
  const request = {
    headers: new Headers({ origin: 'https://vito-preview.77.42.25.224.nip.io' }),
    nextUrl: new URL('http://control-center:3001/api/auth/login'),
  };
  try {
    environment.VITO_CONTROL_CENTER_PUBLIC_ORIGIN = 'https://vito-preview.77.42.25.224.nip.io';
    assert.equal(isSameOriginMutation(request as never), true);
    environment.VITO_CONTROL_CENTER_PUBLIC_ORIGIN = 'https://other.example';
    assert.equal(isSameOriginMutation(request as never), false);
    environment.VITO_CONTROL_CENTER_PUBLIC_ORIGIN = 'https://vito-preview.77.42.25.224.nip.io/path';
    assert.equal(isSameOriginMutation(request as never), false);
  } finally {
    if (previous === undefined) delete environment.VITO_CONTROL_CENTER_PUBLIC_ORIGIN;
    else environment.VITO_CONTROL_CENTER_PUBLIC_ORIGIN = previous;
  }
});

test('private SSH browser origin is exact and cannot be supplied by forwarded headers', () => {
  const previous = process.env.VITO_CONTROL_CENTER_PUBLIC_ORIGIN;
  try {
    process.env.VITO_CONTROL_CENTER_PUBLIC_ORIGIN = 'http://localhost:34122';
    for (const [origin, expected] of [
      ['http://localhost:34122', true],
      ['http://localhost:34120', false],
      // The request's own origin remains allowed by the existing guard.
      ['http://127.0.0.1:34122', true],
      ['https://localhost:34122', false],
      ['http://localhost.attacker.invalid:34122', false],
      ['null', false],
    ] as const) {
      assert.equal(isSameOriginMutation({
        headers: new Headers({ origin, 'x-forwarded-host': 'localhost:34122', 'x-forwarded-proto': 'http' }),
        nextUrl: new URL('http://127.0.0.1:34122/api/auth/login'),
      } as never), expected, origin);
    }
  } finally {
    if (previous === undefined) delete process.env.VITO_CONTROL_CENTER_PUBLIC_ORIGIN;
    else process.env.VITO_CONTROL_CENTER_PUBLIC_ORIGIN = previous;
  }
});
