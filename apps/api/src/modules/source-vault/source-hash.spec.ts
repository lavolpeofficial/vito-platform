import { sha256Hex } from './source-hash';

describe('sha256Hex', () => {
  it('returns the stable SHA-256 digest for text input', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('returns the same digest for equivalent Buffer input', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex('abc'));
  });
});
