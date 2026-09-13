#!/usr/bin/env node

const baseUrl = (process.env.VITO_BASE_URL ?? 'http://127.0.0.1:33000').replace(/\/$/, '');
const email = process.env.VITO_OWNER_EMAIL;
const password = process.env.VITO_OWNER_PASSWORD;
const organizationSlug = process.env.VITO_ORGANIZATION_SLUG ?? 'aterima';

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return body;
}

async function main() {
  required('VITO_OWNER_EMAIL', email);
  required('VITO_OWNER_PASSWORD', password);

  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, organizationSlug }),
  });

  if (!login?.accessToken || login?.user?.role !== 'OWNER') {
    throw new Error('Login response is missing an OWNER access token');
  }

  const summary = await request('/operations/summary', {
    headers: { authorization: `Bearer ${login.accessToken}` },
  });

  if (!summary || typeof summary !== 'object') {
    throw new Error('Operations summary response is invalid');
  }

  console.log('staging-auth-smoke: PASS');
  console.log(`organization=${organizationSlug}`);
  console.log('role=OWNER');
  console.log('operations_summary=ok');
}

main().catch((error) => {
  console.error(`staging-auth-smoke: FAIL: ${error.message}`);
  process.exitCode = 1;
});
