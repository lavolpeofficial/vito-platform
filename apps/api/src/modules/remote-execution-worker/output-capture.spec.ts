import { BoundedOutputCapture } from './output-capture';

describe('BoundedOutputCapture', () => {
  it('captures full output under limit', () => {
    const capture = new BoundedOutputCapture(1024);
    capture.appendStdout(Buffer.from('hello world'));
    expect(capture.getStdout()).toBe('hello world');
    expect(capture.getStderr()).toBe('');
  });

  it('rolling window truncates old data', () => {
    const capture = new BoundedOutputCapture(20);
    capture.appendStdout(Buffer.from('aaa'));
    capture.appendStdout(Buffer.from('bbb'));
    capture.appendStdout(Buffer.from('ccc'));
    capture.appendStdout(Buffer.from('ddd'));
    const result = capture.getStdout();
    const byteLen = Buffer.from(result, 'utf8').byteLength;
    expect(byteLen).toBeLessThanOrEqual(20);
  });

  it('handles binary-ish data without crash', () => {
    const capture = new BoundedOutputCapture(100);
    capture.appendStdout(Buffer.from([0x00, 0xff, 0xfe, 0xfd]));
    capture.appendStderr(Buffer.from([0xc3, 0xa9])); // é in UTF-8
    expect(capture.getStdout().length).toBeGreaterThan(0);
    expect(capture.getStderr().length).toBeGreaterThan(0);
  });

  it('handles rapid writes', () => {
    const capture = new BoundedOutputCapture(512);
    for (let i = 0; i < 100; i++) {
      capture.appendStdout(Buffer.from(`line ${i}\n`));
    }
    const result = capture.getStdout();
    const byteLen = Buffer.from(result, 'utf8').byteLength;
    expect(byteLen).toBeLessThanOrEqual(512);
  });

  it('preserves exact bytes at limit boundary', () => {
    const capture = new BoundedOutputCapture(10);
    capture.appendStdout(Buffer.from('1234567890'));
    expect(capture.getStdout()).toBe('1234567890');
    capture.appendStdout(Buffer.from('A'));
    expect(Buffer.byteLength(capture.getStdout(), 'utf8')).toBeLessThanOrEqual(10);
  });
});
