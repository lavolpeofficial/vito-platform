const DEVELOPMENT_API_URL = 'http://127.0.0.1:3000';

export function getVitoApiBaseUrl(): string {
  const configured = process.env.VITO_API_BASE_URL?.trim();
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('VITO_API_BASE_URL must be configured in production.');
  }

  const url = new URL(configured || DEVELOPMENT_API_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITO_API_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  return url.toString().replace(/\/$/, '');
}
