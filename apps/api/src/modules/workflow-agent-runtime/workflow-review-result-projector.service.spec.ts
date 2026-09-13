import { AssuranceLevel, ReviewVerdict } from '@vito/contracts';
import { WorkflowReviewResultProjectorService } from './workflow-review-result-projector.service';

describe('WorkflowReviewResultProjectorService', () => {
  const service = new WorkflowReviewResultProjectorService();

  it('projects only the typed contract and derives trusted identity fields from runtime evidence', () => {
    const result = service.project({
      invocationId: 'inv-1',
      artifactReferences: ['gov://artifacts/review.json'],
      providerExecutionMetadata: {
        stdout: JSON.stringify({
          verdict: 'B',
          reviewerExecutionId: 'spoofed',
          assuranceLevel: 'AL4',
          artifactRefs: ['gov://spoofed'],
          findings: [{
            id: 'finding-1', severity: 'MEDIUM', category: 'TESTING', summary: 'Missing edge-case test.',
            evidenceRefs: ['gov://evidence/test-gap'], blocking: false,
          }],
        }),
        secretProviderField: 'must-not-persist',
      },
    }, 'AL-3');

    expect(result).toEqual({
      verdict: ReviewVerdict.B,
      findings: [{
        id: 'finding-1', severity: 'MEDIUM', category: 'TESTING', summary: 'Missing edge-case test.',
        evidenceRefs: ['gov://evidence/test-gap'], blocking: false,
      }],
      reviewerExecutionId: 'inv-1',
      assuranceLevel: AssuranceLevel.AL3,
      artifactRefs: ['gov://artifacts/review.json'],
    });
    expect(result as any).not.toHaveProperty('secretProviderField');
  });

  it.each([
    'not json',
    JSON.stringify({ verdict: 'X', findings: [] }),
    JSON.stringify({ verdict: 'A', findings: [{ id: 'f', severity: 'UNKNOWN', category: 'OTHER', summary: 'x', evidenceRefs: [], blocking: false }] }),
    JSON.stringify({ verdict: 'A', findings: [{ id: 'f', severity: 'LOW', category: 'OTHER', summary: 'x', evidenceRefs: ['x'.repeat(2049)], blocking: false }] }),
  ])('fails closed for malformed or out-of-contract review output', (stdout) => {
    expect(service.project({
      invocationId: 'inv-1',
      providerExecutionMetadata: { stdout },
    }, 'AL3')).toBeNull();
  });

  it('fails closed without a trusted invocation id or recognized persisted assurance level', () => {
    const stdout = JSON.stringify({ verdict: 'A', findings: [] });
    expect(service.project({ providerExecutionMetadata: { stdout } }, 'AL3')).toBeNull();
    expect(service.project({ invocationId: 'inv-1', providerExecutionMetadata: { stdout } }, 'AL9')).toBeNull();
  });

  it('rejects markdown-wrapped JSON instead of heuristically extracting provider text', () => {
    expect(service.project({
      invocationId: 'inv-1',
      providerExecutionMetadata: { stdout: '```json\n{"verdict":"A","findings":[]}\n```' },
    }, 'AL2')).toBeNull();
  });
});
