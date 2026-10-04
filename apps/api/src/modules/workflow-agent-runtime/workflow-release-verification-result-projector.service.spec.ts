import { WorkflowReleaseVerificationResultProjectorService } from './workflow-release-verification-result-projector.service';

describe('WorkflowReleaseVerificationResultProjectorService', () => {
  const service = new WorkflowReleaseVerificationResultProjectorService();

  function execution(payload: unknown) {
    return {
      providerExecutionMetadata: {
        stdout: typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    };
  }

  it('projects a structured PASS only with executed checks and no blockers', () => {
    expect(service.project(execution({
      status: 'PASS',
      checksExecuted: 12,
      checksFailed: 0,
      blockingReasons: [],
      evidenceRefs: ['gov://evidence/verify-1'],
    }))).toEqual({
      status: 'PASS',
      checksExecuted: 12,
      checksFailed: 0,
      blockingReasons: [],
      evidenceRefs: ['gov://evidence/verify-1'],
    });
  });

  it('projects FAIL and BLOCKED results with explicit blocking reasons', () => {
    expect(service.project(execution({
      status: 'FAIL',
      checksExecuted: 8,
      checksFailed: 1,
      blockingReasons: ['critical sandbox cleanup test failed'],
      evidenceRefs: [],
    }))).toEqual(expect.objectContaining({ status: 'FAIL', checksFailed: 1 }));

    expect(service.project(execution({
      status: 'BLOCKED',
      checksExecuted: 3,
      checksFailed: 0,
      blockingReasons: ['PostgreSQL verification unavailable'],
      evidenceRefs: [],
    }))).toEqual(expect.objectContaining({ status: 'BLOCKED' }));
  });

  it('rejects prose, malformed PASS claims, and unbounded payloads', () => {
    expect(service.project(execution('VERIFY outcome: FAILED / BLOCKED'))).toBeNull();
    expect(service.project(execution({
      status: 'PASS',
      checksExecuted: 0,
      checksFailed: 0,
      blockingReasons: [],
      evidenceRefs: [],
    }))).toBeNull();
    expect(service.project(execution({
      status: 'PASS',
      checksExecuted: 1,
      checksFailed: 0,
      blockingReasons: ['cannot be PASS with a blocker'],
      evidenceRefs: [],
    }))).toBeNull();
  });
});
