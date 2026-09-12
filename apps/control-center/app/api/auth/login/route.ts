import { NextResponse, type NextRequest } from 'next/server';
import { createPublicVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
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
    const publicClient = createPublicVitoApiClient();
    const login = await publicClient.post('/auth/login', credentials, parseLoginResult);
    const maxAge = parseSessionLifetime(login.expiresIn);
    if (!maxAge) return NextResponse.json({ error: 'The VITO identity response was invalid.' }, { status: 502 });

    const organization = await publicClient.withAccessToken(login.accessToken)
      .get(`/organizations/${encodeURIComponent(login.user.organizationId)}`, parseOrganization);
    if (organization.id !== login.user.organizationId || organization.slug !== credentials.organizationSlug) {
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
  } catch (cause) {
    if (cause instanceof VitoApiError) {
      const error = publicAuthError(cause.status);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'The VITO identity service is currently unavailable.' }, { status: 502 });
  }
}
