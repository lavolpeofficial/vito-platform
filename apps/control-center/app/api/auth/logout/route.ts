import { NextResponse, type NextRequest } from 'next/server';
import { isSameOriginMutation } from '@/lib/auth/request';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Cross-origin logout requests are not allowed.' }, { status: 403 });
  }

  const response = NextResponse.json({ authenticated: false });
  response.headers.set('Cache-Control', 'no-store');
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
    priority: 'high',
  });
  return response;
}
