import type { NextRequest } from 'next/server';

export function isSameOriginMutation(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export function publicAuthError(status: number): Readonly<{ status: number; message: string }> {
  if (status === 400) return { status: 400, message: 'Please check the submitted fields.' };
  if (status === 401) return { status: 401, message: 'Invalid credentials.' };
  if (status === 429) return { status: 429, message: 'Too many login attempts. Please try again later.' };
  return { status: 502, message: 'The VITO identity service is currently unavailable.' };
}
