import { createHash } from 'crypto';

/** Stable content hash used for exact duplicate detection and provenance. */
export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}
