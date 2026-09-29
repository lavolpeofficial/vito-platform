import { buildBoundedExecutionResultSummary, buildGovernedEvidenceBinding } from './governed-evidence-binding';

describe('governed evidence binding', () => {
  it('binds sanitized stdout and governed base revision without retaining raw output', () => {
    const metadata = {
      stdout: 'tests: 42 passed',
      exitCode: 0,
      governedResultSettling: { baseSha: 'a'.repeat(40), changedFiles: ['x.ts'] },
    };
    const binding = buildGovernedEvidenceBinding(metadata);
    expect(binding).toEqual({
      revisionReference: `gov://revision/${'a'.repeat(40)}`,
      stdoutSha256Reference: 'gov://evidence/stdout-sha256/6baeb38b5c5a7cf7536bbabffb2b1a9491583b2ce7f15aa3a01912102819c4c3',
      exitCode: 0,
    });
    expect(JSON.stringify(binding)).not.toContain('42 passed');
  });

  it('preserves a strict raw git SHA even when the generic sanitized metadata redacts that SHA', () => {
    const raw = {
      stdout: 'secret raw output',
      exitCode: 0,
      governedResultSettling: { baseSha: 'b'.repeat(40) },
    };
    const sanitized = {
      stdout: 'redacted safe output',
      exitCode: 0,
      governedResultSettling: { baseSha: '[REDACTED]' },
    };
    const binding = buildGovernedEvidenceBinding(raw, sanitized);
    expect(binding).toEqual({
      revisionReference: `gov://revision/${'b'.repeat(40)}`,
      stdoutSha256Reference: 'gov://evidence/stdout-sha256/d3b48d7960366868479d5fc386092e2461ab8748c18cb4da66e95ab234723dbb',
      exitCode: 0,
    });
    expect(JSON.stringify(binding)).not.toContain('secret raw output');
    expect(JSON.stringify(binding)).not.toContain('redacted safe output');
  });

  it('rejects malformed revision identifiers while retaining other bounded evidence', () => {
    expect(buildGovernedEvidenceBinding({ stdout: 'ok', governedResultSettling: { baseSha: '../main' } }))
      .toEqual({ stdoutSha256Reference: 'gov://evidence/stdout-sha256/2689367b205c16ce32ed4200942b8b8b1e262dfc70d9bc9fbc77c49699a4f1df' });
  });

  it('creates a bounded result summary with a digest of the complete sanitized stdout', () => {
    const summary = buildBoundedExecutionResultSummary({ stdout: 'abcdefghij' }, 4);
    expect(summary).toEqual({
      sha256: '72399361da6a7754fec986dca5b7cbaf1c810a28ded4abaf56b2106d06cb78b0',
      content: 'abcd',
      truncated: true,
      charLength: 10,
    });
  });
});
