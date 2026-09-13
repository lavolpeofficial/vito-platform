import { CapabilitiesService } from './capabilities.service';

describe('CapabilitiesService default-deny provisioning', () => {
  it('grants a DigitalEmployee capability disabled unless explicitly enabled', async () => {
    const tx = {
      digitalEmployeeCapability: {
        upsert: jest.fn().mockResolvedValue({
          digitalEmployeeId: 'employee-1',
          capabilityId: 'capability-1',
          isEnabled: false,
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: any) => callback(tx)),
    } as any;
    const auditService = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const digitalEmployeesService = {
      assertBelongsToOrganization: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new CapabilitiesService(prisma, auditService, digitalEmployeesService);
    jest.spyOn(service, 'findByIdOrFail').mockResolvedValue({ id: 'capability-1' } as any);

    const result = await service.grantToDigitalEmployee(
      'org-1',
      'employee-1',
      'capability-1',
      {},
    );

    expect(tx.digitalEmployeeCapability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ isEnabled: false }),
        update: expect.objectContaining({ isEnabled: false }),
      }),
    );
    expect(result.isEnabled).toBe(false);
  });
});
