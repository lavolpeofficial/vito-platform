import { WorkflowTestResultProjectorService } from './workflow-test-result-projector.service';

describe('WorkflowTestResultProjectorService', () => {
  const service = new WorkflowTestResultProjectorService();

  it('projects a governed PASS result with observed test counts', () => {
    expect(service.project({
      invocationId: 'inv-1',
      providerExecutionMetadata: {
        stdout: JSON.stringify({
          status: 'PASS', testsExecuted: 42, testsFailed: 0, evidenceRefs: ['gov://evidence/test-run'],
        }),
      },
    })).toEqual({
      status: 'PASS', testsExecuted: 42, testsFailed: 0, evidenceRefs: ['gov://evidence/test-run'],
    });
  });

  it('projects BLOCKED so the runtime can reject it instead of treating it as success', () => {
    expect(service.project({
      providerExecutionMetadata: {
        stdout: JSON.stringify({ status: 'BLOCKED', testsExecuted: 0, testsFailed: 0, evidenceRefs: [] }),
      },
    })).toEqual({ status: 'BLOCKED', testsExecuted: 0, testsFailed: 0, evidenceRefs: [] });
  });

  it.each([
    'not json',
    JSON.stringify({ status: 'PASS', testsExecuted: 0, testsFailed: 0, evidenceRefs: [] }),
    JSON.stringify({ status: 'PASS', testsExecuted: 2, testsFailed: 1, evidenceRefs: [] }),
    JSON.stringify({ status: 'FAIL', testsExecuted: 2, testsFailed: 0, evidenceRefs: [] }),
    JSON.stringify({ status: 'PASS', testsExecuted: 2, testsFailed: 0 }),
  ])('fails closed for malformed or semantically invalid output: %s', (stdout) => {
    expect(service.project({ providerExecutionMetadata: { stdout } })).toBeNull();
  });

  it('rejects markdown-wrapped JSON instead of heuristically extracting provider prose', () => {
    expect(service.project({
      providerExecutionMetadata: {
        stdout: '```json\n{"status":"PASS","testsExecuted":2,"testsFailed":0,"evidenceRefs":[]}\n```',
      },
    })).toBeNull();
  });
});