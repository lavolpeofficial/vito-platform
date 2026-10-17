// Private UI runtime probe. Never log credentials, cookies or response bodies.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const origin = process.env.VITO_SMOKE_ORIGIN || 'http://localhost:34122';
const transport = process.env.VITO_SMOKE_TRANSPORT || 'http://127.0.0.1:34122';
function requireGate(condition, name) {
  if (!condition) throw new Error(name);
}
async function request(path, options = {}) {
  return fetch(transport + path, {
    ...options,
    headers: { Host: new URL(origin).host, ...options.headers },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
}

export async function runSmoke(send = request, readPassword = async () =>
  (await readFile(process.env.VITO_SMOKE_PASSWORD_FILE, 'utf8')).trim(), identity = {
    organizationSlug: process.env.VITO_SMOKE_ORGANIZATION, email: process.env.VITO_SMOKE_EMAIL,
  }) {
  // Negative control: an unrelated browser origin must still be rejected.
  const denied = await send('/api/auth/login', {
    method: 'POST', headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'application/json' },
    body: '{}',
  });
  requireGate(denied.status === 403, 'CROSS_ORIGIN_NOT_REJECTED');
  await denied.arrayBuffer();
  const anonymous = await send('/api/auth/session');
  requireGate(anonymous.status === 401, 'ANONYMOUS_SESSION_NOT_REJECTED');
  await anonymous.arrayBuffer();
  const anonymousActivity = await send('/riccardo/activity');
  requireGate([307, 308].includes(anonymousActivity.status), 'ANONYMOUS_ACTIVITY_NOT_REDIRECTED');
  const location = new URL(anonymousActivity.headers.get('location') || '/', origin);
  requireGate(location.pathname === '/login', 'ANONYMOUS_ACTIVITY_REDIRECT_NOT_LOGIN');
  await anonymousActivity.arrayBuffer();

  const password = await readPassword();
  const login = await send('/api/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ organizationSlug: identity.organizationSlug, email: identity.email, password }),
  });
  requireGate(login.status === 200, `UI_LOGIN_STATUS_${login.status}`);
  const body = await login.json();
  requireGate(body.session?.user?.role === 'OWNER' && body.session?.organization?.slug === identity.organizationSlug, 'UI_LOGIN_IDENTITY');
  const cookies = login.headers.getSetCookie().filter(value => value.startsWith('__Host-vito_session='));
  requireGate(cookies.length === 1, 'SESSION_COOKIE_MISSING');
  const cookie = cookies[0];
  requireGate(/;\s*Secure(?:;|$)/i.test(cookie) && /;\s*HttpOnly(?:;|$)/i.test(cookie)
    && /;\s*SameSite=Strict(?:;|$)/i.test(cookie) && /;\s*Path=\/(?:;|$)/i.test(cookie)
    && !/;\s*Domain=/i.test(cookie), 'SESSION_COOKIE_POLICY');
  // Use the actual UI-issued cookie, never manufacture a session from an API JWT.
  // This is an HTTP probe, not proof of a browser's Secure-cookie acceptance.
  const headers = { Cookie: cookie.split(';', 1)[0] };
  const session = await send('/api/auth/session', { headers });
  requireGate(session.status === 200, `SESSION_STATUS_${session.status}`);
  const restored = await session.json();
  requireGate(restored.session?.user?.id === body.session.user.id
    && restored.session?.organization?.id === body.session.organization.id, 'SESSION_IDENTITY_MISMATCH');
  const activity = await send('/riccardo/activity', { headers });
  requireGate(activity.status === 200, `ACTIVITY_SSR_STATUS_${activity.status}`);
  const html = await activity.text();
  requireGate(html.includes('Prüfaufträge') && html.includes('STAGING TEST'), 'ACTIVITY_DATA_MISSING');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  requireGate(Boolean(process.env.VITO_SMOKE_PASSWORD_FILE && process.env.VITO_SMOKE_ORGANIZATION && process.env.VITO_SMOKE_EMAIL), 'EXPLICIT_PRIVATE_CONFIG_REQUIRED');
  for (const value of [origin, transport]) {
    const url = new URL(value);
    requireGate(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:'
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'LOOPBACK_ONLY');
  }
  await runSmoke();
  console.log('R316_UI_LOGIN_COOKIE_SESSION_ACTIVITY=PASS R316_FOREIGN_ORIGIN=DENIED');
  console.log('R316_BROWSER_COOKIE_ACCEPTANCE=MANUAL_CHECK_REQUIRED');
 } catch (error) {
  // Only our allowlisted gate labels are exported, never arbitrary fetch errors.
  const label = /^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'HTTP_PROBE_FAILED';
  console.error(`R316_SMOKE=BLOCKED R316_REASON=${label}`);
  process.exitCode = 1;
 }
}
