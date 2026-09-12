import { BadRequestException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { WorkflowVerificationController, parseLimit, parseStatus } from './workflow-verification.controller';
import { WorkflowVerificationService } from './workflow-verification.service';

describe('WorkflowVerificationController observability', () => {
  it('delegates a bounded tenant-scoped read without creating verification evidence', async () => {
    const listForRun = jest.fn().mockResolvedValue([]);
    const controller = new WorkflowVerificationController(
      { listForRun } as unknown as WorkflowVerificationService,
      { getOrThrow: () => 'org-1' } as unknown as TenantContext,
    );

    await controller.listForRun(' run-1 ', 'VERIFIED', '25');

    expect(listForRun).toHaveBeenCalledWith('org-1', 'run-1', { status: 'VERIFIED', limit: 25 });
  });

  it('keeps verification mutation delegated to the authoritative service', async () => {
    const verifyStep = jest.fn().mockResolvedValue({ id: 'verification-1' });
    const controller = new WorkflowVerificationController(
      { verifyStep } as unknown as WorkflowVerificationService,
      { getOrThrow: () => 'org-1' } as unknown as TenantContext,
    );

    await controller.verify('run-1', 'step-1');

    expect(verifyStep).toHaveBeenCalledWith('org-1', 'run-1', 'step-1');
  });
});

describe('workflow verification observability boundaries', () => {
  it('accepts only persisted verification statuses', () => {
    expect(parseStatus(' VERIFIED ')).toBe('VERIFIED');
    expect(parseStatus('BLOCKED')).toBe('BLOCKED');
    expect(() => parseStatus('SUCCEEDED')).toThrow(BadRequestException);
    expect(() => parseStatus(' ')).toThrow(BadRequestException);
  });

  it('bounds result size before querying persistence', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('200')).toBe(200);
    expect(() => parseLimit('0')).toThrow(BadRequestException);
    expect(() => parseLimit('201')).toThrow(BadRequestException);
    expect(() => parseLimit('1.5')).toThrow(BadRequestException);
  });
});
