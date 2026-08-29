import { createHash } from 'node:crypto';
import type { GovernedResultSettling } from '../remote-execution-worker/change-set-capture';

/**
 * Flight 001 canonical proof definition (OB-002D).
 *
 * The canonical proof is a SINGLE markdown file at docs/vito-flight-001-proof.md.
 * Its byte sha256 (c332bc62...) was established in Phase 0 evidence and is the
 * exact acceptance postcondition: byte-equivalent content, exactly one file,
 * no unrelated mutation. Nothing else may be created, modified or deleted.
 */
export const VITO_FLIGHT_001_PROOF_RELATIVE_PATH = 'docs/vito-flight-001-proof.md';

export const VITO_FLIGHT_001_PROOF_CONTENT = [
  '# VITO Flight 001 Self-Determination Proof',
  '',
  'Issued by: vito-platform',
  'Flight: 001',
  'Provider: openai',
  'Mode: governed-cloud-execution (OB-002D)',
  '',
  'This document proves VITO flight 001 still flies.',
].join('\n') + '\n';

export const VITO_FLIGHT_001_EXPECTED_SHA256 =
  'c332bc62e9b11036400b2006eb6215dd773c175ce0d4736b19a6bae6928811b0';

export interface Flight001AcceptanceResult {
  readonly passed: boolean;
  readonly reason?: string;
  readonly changedFiles: readonly string[];
  readonly expectedPath: string;
  readonly expectedSha256: string;
  readonly actualSha256: string | null;
  readonly baseSha: string;
}

/**
 * Evaluate the Flight 001 acceptance postconditions against the authoritative
 * settled change-set.
 *
 * All three conditions must hold (fail closed, no partial acceptance):
 *  1. Exactly one changed file, at the canonical proof path.
 *  2. The patch reconstructs byte-equivalent expected content.
 *  3. Reconstructed bytes hash to the canonical expected sha256.
 *
 * The agent's own success exit code is NOT sufficient for acceptance — a zero
 * exit with an unrelated or empty change-set fails acceptance even if the
 * process reported success.
 */
export function evaluateFlight001Acceptance(
  settling: GovernedResultSettling,
): Flight001AcceptanceResult {
  const common = {
    changedFiles: [...settling.changedFiles],
    expectedPath: VITO_FLIGHT_001_PROOF_RELATIVE_PATH,
    expectedSha256: VITO_FLIGHT_001_EXPECTED_SHA256,
    baseSha: settling.baseSha,
  };

  if (settling.empty || settling.changedFiles.length === 0) {
    return { ...common, passed: false, reason: 'no files changed', actualSha256: null };
  }

  if (
    settling.changedFiles.length !== 1 ||
    settling.changedFiles[0] !== VITO_FLIGHT_001_PROOF_RELATIVE_PATH
  ) {
    return {
      ...common,
      passed: false,
      reason: 'changed files must be exactly the canonical proof file',
      actualSha256: null,
    };
  }

  const reconstructed = extractNewFileContent(settling.patch, VITO_FLIGHT_001_PROOF_RELATIVE_PATH);
  if (reconstructed === null) {
    return {
      ...common,
      passed: false,
      reason: 'patch does not contain the canonical proof file as the only new file',
      actualSha256: null,
    };
  }

  const actualSha = sha256Utf8(reconstructed);

  if (reconstructed !== VITO_FLIGHT_001_PROOF_CONTENT) {
    return {
      ...common,
      passed: false,
      reason: 'proof content is not byte-equivalent to the canonical content',
      actualSha256: actualSha,
    };
  }

  if (actualSha !== VITO_FLIGHT_001_EXPECTED_SHA256) {
    return {
      ...common,
      passed: false,
      reason: 'proof content hash does not match the canonical expected hash',
      actualSha256: actualSha,
    };
  }

  return { ...common, passed: true, actualSha256: actualSha };
}

/**
 * Extract a new-file (--- /dev/null) content from a unified `git diff --binary`
 * patch for exactly one path. Returns null when:
 *  - the patch is malformed,
 *  - more than one diff header exists,
 *  - the path does not appear as a new file, or
 *  - the file is marked '\\ No newline at end of file' (content mismatch).
 */
export function extractNewFileContent(
  patch: string,
  expectedPath: string,
): string | null {
  const headers = patch.match(/^diff --git a\/.+\sb\/.+$/gm);
  if (!headers || headers.length !== 1) {
    return null;
  }

  const diffHeader = headers[0];
  const bPath = diffHeader.replace(/^diff --git a\//, '').replace(/\sb\/.+$/, '');
  if (bPath !== expectedPath) {
    return null;
  }

  const lines = patch.split('\n');

  let inTarget = false;
  let sawNewFileMarker = false;
  const contentLines: string[] = [];

  for (const line of lines) {
    if (/^diff --git /.test(line)) {
      if (inTarget) break;
      continue;
    }
    if (line === 'new file mode 100644') {
      sawNewFileMarker = true;
      continue;
    }
    if (line === '--- /dev/null') {
      inTarget = true;
      continue;
    }
    if (!inTarget) continue;
    if (/^\\ No newline at end of file/.test(line)) {
      return null;
    }
    if (/^\+\+\+ /.test(line)) continue;
    if (/^--- /.test(line)) continue;
    if (/^@@ /.test(line)) continue;
    if (line.startsWith('+')) {
      contentLines.push(line.slice(1));
    }
  }

  if (!sawNewFileMarker || contentLines.length === 0) {
    return null;
  }

  return `${contentLines.join('\n')}\n`;
}

function sha256Utf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}