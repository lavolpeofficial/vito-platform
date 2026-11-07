import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { TenantContext } from '../../common/tenant/tenant-context';
import { isAuthorizedOwnerBusReader, isRestrictedBusReader, normalizeOwnerReceipts } from './owner-bus.contract';
import { ExecutiveReceiptsService } from './executive-receipts.service';

const OWNER = '19191919-2222-4333-8444-555555555555';
const OTHER = '11111111-2222-4333-8444-666666666666';
const claims = { organizationId: OWNER, userId: 'owner-account', role: 'OWNER', authenticationMethod: 'jwt' };
const privilege = {
  can_select_view: true,
  can_select_table: false,
  can_insert_table: false,
  can_update_table: false,
  can_delete_table: false,
};
const row = {
  dispatch_id: 67n,
  recipient: 'emporio',
  topic: 'handoff',
  subject: 'Review private shared footer',
  dispatched_at: new Date('2026-11-06T14:39:04.252Z'),
  receipt_id: 69n,
};

describe('single Owner tenant controls', () => {
  it('permits only explicit matching OWNER JWT account', () => {
    expect(isAuthorizedOwnerBusReader(claims, OWNER)).toBe(true);
    expect(isAuthorizedOwnerBusReader(claims, OTHER)).toBe(false);
    expect(isAuthorizedOwnerBusReader({ ...claims, userId: null }, OWNER)).toBe(false);
    expect(isAuthorizedOwnerBusReader({ ...claims, role: 'ADMIN' }, OWNER)).toBe(false);
    expect(isAuthorizedOwnerBusReader({ ...claims, authenticationMethod: 'insecure-header' }, OWNER)).toBe(false);
    expect(isAuthorizedOwnerBusReader(claims, 'wrong-org-id')).toBe(false);
  });

  it('refuses a database owner role or direct underlying-table visibility', () => {
    expect(isRestrictedBusReader(privilege)).toBe(true);
    expect(isRestrictedBusReader({ ...privilege, can_select_view: false })).toBe(false);
    expect(isRestrictedBusReader({ ...privilege, can_select_table: true })).toBe(false);
    expect(isRestrictedBusReader({ ...privilege, can_insert_table: true })).toBe(false);
    expect(isRestrictedBusReader({ ...privilege, can_update_table: true })).toBe(false);
    expect(isRestrictedBusReader({ ...privilege, can_delete_table: true })).toBe(false);
  });
});

describe('bounded, unsigned receipt records', () => {
  it('keeps all three proof flags false and converts bigint IDs', () => {
    expect(normalizeOwnerReceipts([row])).toEqual([{
      dispatchId: '67', recipient: 'emporio', topic: 'handoff',
      subject: row.subject, dispatchedAt: '2026-11-06T14:39:04.252Z',
      receiptId: '69', receiptState: 'RECEIPT_REPORTED_UNVERIFIED_SENDER',
      authenticatedAgentAck: false, executionVerified: false, ownerReleaseApproved: false,
    }]);
  });

  it('a missing receipt cannot become an ACK or a completed task', () => {
    const value = normalizeOwnerReceipts([{ ...row, receipt_id: null }]);
    expect(value[0].receiptState).toBe('DISPATCHED_NOT_ACKNOWLEDGED');
    expect(value[0].authenticatedAgentAck).toBe(false);
    expect(value[0].executionVerified).toBe(false);
  });

  it('rejects unknown recipient, forged sender and misleading statuses', () => {
    for (const invalid of [
      { ...row, recipient: 'another-tenant' }, { ...row, topic: 'report' },
      { ...row, dispatch_id: '0' }, { ...row, receipt_id: 'bad' },
      { ...row, subject: '' }, { ...row, dispatched_at: 'not-a-date' },
    ]) expect(() => normalizeOwnerReceipts([invalid])).toThrow();
  });

  it('rejects duplicates and unbounded rows', () => {
    expect(() => normalizeOwnerReceipts([row, row])).toThrow();
    expect(() => normalizeOwnerReceipts(Array.from({length: 101},(_,i)=>({...row,dispatch_id:BigInt(i+1)})))).toThrow();
  });

  it('valid empty read is distinct from provider or authorization failure', () => {
    expect(normalizeOwnerReceipts([])).toEqual([]);
  });
});

describe('service fails closed before any database connection', () => {
  const old = {...process.env};

  afterEach(() => {
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID = old.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID;
    process.env.VITO_CONTROL_BUS_READER_ENABLED = old.VITO_CONTROL_BUS_READER_ENABLED;
    process.env.VITO_CONTROL_BUS_READONLY_DATABASE_URL = old.VITO_CONTROL_BUS_READONLY_DATABASE_URL;
  });

  it('rejects cross-tenant before opening a reader connection', async () => {
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID = OWNER;
    process.env.VITO_CONTROL_BUS_READER_ENABLED = 'true';
    const tenant = {
      getOrThrow: () => OTHER,
      getRole: () => 'OWNER',
      getUserId: () => 'owner-account',
      getAuthenticationMethod: () => 'jwt',
    } as TenantContext;
    await expect(new ExecutiveReceiptsService().overview(tenant)).rejects.toThrow(ForbiddenException);
  });

  it('refuses provider-disabled owner without creating a fake empty response', async () => {
    process.env.VITO_CONTROL_BUS_OWNER_ORGANIZATION_ID = OWNER;
    process.env.VITO_CONTROL_BUS_READER_ENABLED = 'false';
    const tenant = {
      getOrThrow: () => OWNER,
      getRole: () => 'OWNER',
      getUserId: () => 'owner-account',
      getAuthenticationMethod: () => 'jwt',
    } as TenantContext;
    await expect(new ExecutiveReceiptsService().overview(tenant)).rejects.toThrow(ServiceUnavailableException);
  });
});
