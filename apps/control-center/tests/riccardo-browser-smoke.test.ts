import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore Operational JavaScript probe, run directly by Node on FSN1.
import { runSmoke } from '../../../scripts/staging/riccardo-browser-smoke.mjs';

const loginIdentity = { organizationSlug: 'synthetic-stage', email: 'synthetic-owner@example.invalid' };
const cookie = '__Host-vito_session=synthetic-ui-cookie; Path=/; HttpOnly; Secure; SameSite=Strict';
const identity = { user: { id: 'synthetic-user', role: 'OWNER' }, organization: { id: 'synthetic-org', slug: 'synthetic-stage' } };
function fixture(options: { cookie?: string; ssrStatus?: number; wrongSession?: boolean } = {}) {
  const calls: string[] = [];
  const send = async (path: string, init: { headers?: Record<string, string>; body?: string } = {}) => {
    calls.push(path);
    const headers = init.headers || {};
    if (path === '/api/auth/login') {
      if (headers.Origin === 'https://untrusted.invalid') return new Response('{}', { status: 403 });
      assert.equal(headers.Origin, 'http://localhost:34122');
      assert.equal(JSON.parse(init.body || '{}').password, 'synthetic-password');
      return Response.json({ session: identity }, { headers: { 'Set-Cookie': options.cookie ?? cookie } });
    }
    if (headers.Cookie) assert.equal(headers.Cookie, '__Host-vito_session=synthetic-ui-cookie');
    if (path === '/api/auth/session') {
      if (!headers.Cookie) return new Response('{}', { status: 401 });
      return Response.json({ session: options.wrongSession ? { ...identity, user: { id: 'other' } } : identity });
    }
    assert.equal(path, '/riccardo/activity');
    if (!headers.Cookie) return new Response('', { status: 307, headers: { Location: '/login' } });
    return new Response('Prüfaufträge STAGING TEST', { status: options.ssrStatus ?? 200 });
  };
  return { calls, send };
}

test('private smoke exercises UI login and reuses only its issued cookie', async () => {
  const f = fixture();
  await runSmoke(f.send, async () => 'synthetic-password', loginIdentity);
  assert.equal(f.calls.filter(path => path === '/api/auth/login').length, 2);
  assert.ok(!f.calls.includes('/auth/login'), 'must not substitute the raw backend login');
});

test('private smoke detects R315 authenticated SSR redirect regression', async () => {
  await assert.rejects(runSmoke(fixture({ ssrStatus: 307 }).send, async () => 'synthetic-password', loginIdentity), /ACTIVITY_SSR_STATUS_307/);
});

test('private smoke rejects insecure UI cookies and mismatched sessions', async () => {
  await assert.rejects(runSmoke(fixture({ cookie: cookie.replace('; Secure', '') }).send, async () => 'synthetic-password', loginIdentity), /SESSION_COOKIE_POLICY/);
  await assert.rejects(runSmoke(fixture({ wrongSession: true }).send, async () => 'synthetic-password', loginIdentity), /SESSION_IDENTITY_MISMATCH/);
});
