import type { NextRequest } from 'next/server';

function configuredPublicOrigin(): string | null {
  const value = process.env.VITO_CONTROL_CENTER_PUBLIC_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isSameOriginMutation(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const requestOrigin = new URL(origin).origin;
    if (requestOrigin === request.nextUrl.origin) return true;
    const publicOrigin = configuredPublicOrigin();
    return publicOrigin !== null && requestOrigin === publicOrigin;
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
