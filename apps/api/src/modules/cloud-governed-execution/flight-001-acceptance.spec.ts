import { createHash } from 'node:crypto';
import {
  VITO_FLIGHT_001_PROOF_CONTENT,
  VITO_FLIGHT_001_PROOF_RELATIVE_PATH,
  evaluateFlight001Acceptance,
  extractNewFileContent,
} from './flight-001-acceptance';
import type { GovernedResultSettling } from '../remote-execution-worker/change-set-capture';

const BASE_SHA = 'a'.repeat(40);

function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Render a `git diff --binary` new-file patch for exactly one path. */
function newFilePatch(path: string, content: string): string {
  const withNewline = content.endsWith('\n') ? content : `${content}\n`;
  const body = withNewline
    .slice(0, -1)
    .split('\n')
    .map((line) => `+${line}`)
    .join('\n');
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    `--- /dev/null`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${withNewline.slice(0, -1).split('\n').length} @@`,
    body,
  ].join('\n');
}

function settling(overrides: Partial<GovernedResultSettling> = {}): GovernedResultSettling {
  const path = VITO_FLIGHT_001_PROOF_RELATIVE_PATH;
  return {
    executionId: 'exec-1',
    baseSha: BASE_SHA,
    changedFiles: [path],
    patch: newFilePatch(path, VITO_FLIGHT_001_PROOF_CONTENT),
    empty: false,
    ...overrides,
  };
}

describe('evaluateFlight001Acceptance (OB-002D acceptance postconditions)', () => {
  it('exact canonical proof mutation passes with the canonical sha', () => {
    const result = evaluateFlight001Acceptance(settling());
    expect(result.passed).toBe(true);
    expect(result.actualSha256).toBe('c332bc62e9b11036400b2006eb6215dd773c175ce0d4736b19a6bae6928811b0');
    expect(result.expectedPath).toBe(VITO_FLIGHT_001_PROOF_RELATIVE_PATH);
    expect(result.baseSha).toBe(BASE_SHA);
  });

  it('empty change-set fails closed', () => {
    const result = evaluateFlight001Acceptance(settling({ empty: true, changedFiles: [], patch: '' }));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('no files changed');
    expect(result.actualSha256).toBeNull();
  });

  it('zero changed files fails closed even when the agent reported success', () => {
    const result = evaluateFlight001Acceptance(settling({ changedFiles: [], patch: '' }));
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('no files changed');
  });

  it('an unrelated mutation fails (exactly-one canonical file required)', () => {
    const result = evaluateFlight001Acceptance(
      settling({
        changedFiles: ['src/evil.ts'],
        patch: newFilePatch('src/evil.ts', 'console.log(1);\n'),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('changed files must be exactly the canonical proof file');
  });

  it('the canonical file plus an extra file fails', () => {
    const result = evaluateFlight001Acceptance(
      settling({ changedFiles: [VITO_FLIGHT_001_PROOF_RELATIVE_PATH, 'src/extra.ts'] }),
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('changed files must be exactly the canonical proof file');
  });

  it('non-byte-equivalent content fails even when sha256 is recomputed', () => {
    const modified = VITO_FLIGHT_001_PROOF_CONTENT.replace(
      'still flies.',
      'still flies, now with modern documentation.',
    );
    const result = evaluateFlight001Acceptance(
      settling({ patch: newFilePatch(VITO_FLIGHT_001_PROOF_RELATIVE_PATH, modified) }),
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('not byte-equivalent');
    expect(result.actualSha256).toBe(sha256Utf8(modified));
  });

  it('a missing trailing newline (git marker) is rejected by the extractor', () => {
    const base = newFilePatch(VITO_FLIGHT_001_PROOF_RELATIVE_PATH, VITO_FLIGHT_001_PROOF_CONTENT);
    const withMarker = `${base}\n\\ No newline at end of file`;
    const result = evaluateFlight001Acceptance(
      settling({ patch: withMarker }),
    );
    expect(result.passed).toBe(false);
  });

  it('canonical content really hashes to the expected sha (no drift)', () => {
    expect(sha256Utf8(VITO_FLIGHT_001_PROOF_CONTENT)).toBe(
      'c332bc62e9b11036400b2006eb6215dd773c175ce0d4736b19a6bae6928811b0',
    );
  });
});

describe('extractNewFileContent', () => {
  it('accepts precisely the canonical new-file patch', () => {
    const patch = newFilePatch(VITO_FLIGHT_001_PROOF_RELATIVE_PATH, VITO_FLIGHT_001_PROOF_CONTENT);
    expect(extractNewFileContent(patch, VITO_FLIGHT_001_PROOF_RELATIVE_PATH)).toBe(
      VITO_FLIGHT_001_PROOF_CONTENT,
    );
  });

  it('returns null for a malformed patch without a diff header', () => {
    expect(extractNewFileContent('some text without headers\n', VITO_FLIGHT_001_PROOF_RELATIVE_PATH)).toBeNull();
  });

  it('returns null when the patch has more than one diff header', () => {
    const one = newFilePatch('a.txt', 'a\n');
    const two = newFilePatch(VITO_FLIGHT_001_PROOF_RELATIVE_PATH, VITO_FLIGHT_001_PROOF_CONTENT);
    expect(extractNewFileContent(`${one}\n${two}`, VITO_FLIGHT_001_PROOF_RELATIVE_PATH)).toBeNull();
  });

  it('returns null for a different path', () => {
    const patch = newFilePatch(VITO_FLIGHT_001_PROOF_RELATIVE_PATH, VITO_FLIGHT_001_PROOF_CONTENT);
    expect(extractNewFileContent(patch, 'docs/other.md')).toBeNull();
  });
});