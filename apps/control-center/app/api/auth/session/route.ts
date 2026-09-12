import { NextResponse } from 'next/server';
import { getAuthenticatedSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function GET() {
  const session = await getAuthenticatedSession();
  const response = session
    ? NextResponse.json({ session })
    : NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  response.headers.set('Cache-Control', 'no-store');
  if (!session) response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
