import { BoundedOutputCapture } from './output-capture';

describe('BoundedOutputCapture', () => {
  it('captures full output under limit', () => {
    const capture = new BoundedOutputCapture(1024);
    capture.appendStdout(Buffer.from('hello'));
    capture.appendStderr(Buffer.from('warn'));
    expect(capture.getStdout()).toBe('hello');
    expect(capture.getStderr()).toBe('warn');
  });

  it('rolling window truncates old data', () => {
    const capture = new BoundedOutputCapture(20);
    capture.appendStdout(Buffer.from('0123456789'));
    capture.appendStdout(Buffer.from('abcdefghij'));
    const result = capture.getStdout();
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(20);
    expect(result).toContain('abcdefghij');
  });

  it('handles binary-ish data without crash', () => {
    const capture = new BoundedOutputCapture(128);
    const binary = Buffer.alloc(64);
    for (let i = 0; i < 64; i++) binary[i] = i;
    expect(() => {
      capture.appendStdout(binary);
      capture.appendStderr(binary);
    }).not.toThrow();
  });

  it('handles rapid writes', () => {
    const capture = new BoundedOutputCapture(256);
    for (let i = 0; i < 1000; i++) {
      capture.appendStdout(Buffer.from(`line-${i}\n`));
    }
    const result = capture.getStdout();
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(256);
    expect(result).toContain('line-999');
  });

  it('preserves exact bytes at limit boundary', () => {
    const limit = 50;
    const capture = new BoundedOutputCapture(limit);
    const first = 'a'.repeat(30);
    const second = 'b'.repeat(30);
    capture.appendStdout(Buffer.from(first));
    capture.appendStdout(Buffer.from(second));
    const result = capture.getStdout();
    expect(Buffer.byteLength(result, 'utf8')).toBe(limit);
    expect(result.length).toBe(limit);
  });
});
