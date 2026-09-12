import { NextResponse, type NextRequest } from 'next/server';
import { getVitoApiBaseUrl } from '@/lib/auth/config';
import { parseLoginCredentials, parseLoginResult, parseOrganization, parseSessionLifetime } from '@/lib/auth/contracts';
import { isSameOriginMutation, publicAuthError } from '@/lib/auth/request';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Cross-origin login requests are not allowed.' }, { status: 403 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return NextResponse.json({ error: 'Please check the submitted fields.' }, { status: 413 });
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, 'utf8') > 16_384) {
      return NextResponse.json({ error: 'Please check the submitted fields.' }, { status: 413 });
    }
    input = JSON.parse(body) as unknown;
  } catch {
    return NextResponse.json({ error: 'Please check the submitted fields.' }, { status: 400 });
  }

  const credentials = parseLoginCredentials(input);
  if (!credentials) return NextResponse.json({ error: 'Please check the submitted fields.' }, { status: 400 });

  try {
    const baseUrl = getVitoApiBaseUrl();
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(credentials),
      cache: 'no-store',
    });
    if (!loginResponse.ok) {
      const error = publicAuthError(loginResponse.status);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const login = parseLoginResult(await loginResponse.json());
    const maxAge = login ? parseSessionLifetime(login.expiresIn) : null;
    if (!login || !maxAge) return NextResponse.json({ error: 'The VITO identity response was invalid.' }, { status: 502 });

    const organizationResponse = await fetch(`${baseUrl}/organizations/${encodeURIComponent(login.user.organizationId)}`, {
      headers: { Authorization: `Bearer ${login.accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!organizationResponse.ok) return NextResponse.json({ error: 'The tenant context could not be verified.' }, { status: 502 });

    const organization = parseOrganization(await organizationResponse.json());
    if (!organization || organization.id !== login.user.organizationId || organization.slug !== credentials.organizationSlug) {
      return NextResponse.json({ error: 'The tenant context could not be verified.' }, { status: 502 });
    }

    const response = NextResponse.json({ session: { user: login.user, organization } });
    response.headers.set('Cache-Control', 'no-store');
    response.cookies.set(SESSION_COOKIE_NAME, login.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge,
      priority: 'high',
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'The VITO identity service is currently unavailable.' }, { status: 502 });
  }
}
