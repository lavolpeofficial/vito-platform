import type { OutputCapture } from './types';

const DEFAULT_MAX_BYTES = 256 * 1024;

export class BoundedOutputCapture implements OutputCapture {
  private stdout = '';
  private stderr = '';
  private readonly maxBytes: number;

  constructor(maxBytes = DEFAULT_MAX_BYTES) {
    this.maxBytes = maxBytes;
  }

  getStdout(): string {
    return this.stdout;
  }

  getStderr(): string {
    return this.stderr;
  }

  appendStdout(chunk: Buffer): void {
    this.stdout = appendBounded(this.stdout, chunk, this.maxBytes);
  }

  appendStderr(chunk: Buffer): void {
    this.stderr = appendBounded(this.stderr, chunk, this.maxBytes);
  }
}

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string {
  const combined = current + chunk.toString('utf8');
  const bytes = Buffer.from(combined, 'utf8');
  if (bytes.byteLength <= maxBytes) return combined;
  return bytes.subarray(bytes.byteLength - maxBytes).toString('utf8');
}
