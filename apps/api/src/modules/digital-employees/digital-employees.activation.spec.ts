import { BadRequestException } from '@nestjs/common';
import { DigitalEmployeesService } from './digital-employees.service';

describe('DigitalEmployeesService activation gate', () => {
  const audit = { record: jest.fn() } as any;

  it('blocks direct ACTIVE updates', async () => {
    const prisma = { digitalEmployee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', capabilities: [] }) } } as any;
    const service = new DigitalEmployeesService(prisma, audit);
    await expect(service.update('org1', 'e1', { status: 'ACTIVE' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires at least one enabled capability', async () => {
    const prisma = { digitalEmployee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', status: 'DRAFT', capabilities: [{ isEnabled: false, capability: { code: 'C1', riskLevel: 'LOW', requiresApproval: false } }] }) } } as any;
    const service = new DigitalEmployeesService(prisma, audit);
    await expect(service.activate('org1', 'e1', { capabilitiesReviewed: true, dataAccessReviewed: true, approvalNote: 'Reviewed and approved.' })).rejects.toThrow('At least one capability must be explicitly enabled');
  });

  it('rejects high-risk enabled capabilities without approval', async () => {
    const prisma = { digitalEmployee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', status: 'DRAFT', capabilities: [{ isEnabled: true, capability: { code: 'HIGH_RISK', riskLevel: 'HIGH', requiresApproval: false } }] }) } } as any;
    const service = new DigitalEmployeesService(prisma, audit);
    await expect(service.activate('org1', 'e1', { capabilitiesReviewed: true, dataAccessReviewed: true, approvalNote: 'Reviewed and approved.' })).rejects.toThrow('High-risk capabilities must require approval');
  });
});
