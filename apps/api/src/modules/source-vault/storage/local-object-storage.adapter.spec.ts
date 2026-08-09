import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalObjectStorageAdapter } from './local-object-storage.adapter';

describe('LocalObjectStorageAdapter', () => {
  let root: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    previousRoot = process.env.SOURCE_VAULT_LOCAL_DIR;
    root = await mkdtemp(join(tmpdir(), 'vito-source-vault-'));
    process.env.SOURCE_VAULT_LOCAL_DIR = root;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.SOURCE_VAULT_LOCAL_DIR;
    else process.env.SOURCE_VAULT_LOCAL_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  it('stores immutable bytes and retrieves them', async () => {
    const adapter = new LocalObjectStorageAdapter();
    const body = Buffer.from('source-vault-test');

    const stored = await adapter.putImmutable({
      organizationId: 'org-1',
      sourceId: 'SRC-2026-TEST',
      filename: 'input.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body,
    });

    expect(stored.storageUri).toBe('local://raw/org-1/SRC-2026-TEST/input.xlsx');
    expect(await adapter.exists(stored.storageUri)).toBe(true);
    expect(await adapter.get(stored.storageUri)).toEqual(body);

    await expect(
      adapter.putImmutable({
        organizationId: 'org-1',
        sourceId: 'SRC-2026-TEST',
        filename: 'input.xlsx',
        mimeType: 'application/octet-stream',
        body: Buffer.from('must-not-overwrite'),
      }),
    ).rejects.toBeDefined();

    expect(await adapter.get(stored.storageUri)).toEqual(body);
  });

  it('prevents traversal through storage URIs', async () => {
    const adapter = new LocalObjectStorageAdapter();
    await expect(adapter.get('local://../../outside.txt')).rejects.toThrow('außerhalb');
  });
});
