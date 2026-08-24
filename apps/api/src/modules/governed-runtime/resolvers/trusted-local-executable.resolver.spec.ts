import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TrustedLocalExecutableResolver } from './trusted-local-executable.resolver';

describe('TrustedLocalExecutableResolver', () => {
  let dir: string;
  let executable: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), `vito-exec-${randomUUID()}-`));
    executable = join(dir, 'agent-tool');
    await writeFile(executable, '#!/bin/sh\necho ok\n', 'utf8');
    await chmod(executable, 0o755);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const context = {
    organizationId: 'org-1',
    workflowRunId: 'run-1',
    capabilityCode: 'CODE_BUILD',
    providerId: 'provider-1',
  };

  const resolverFor = (mapping: Record<string, string>) =>
    new TrustedLocalExecutableResolver(JSON.stringify(mapping), dir);

  it('resolves only an explicitly mapped launcher inside the trusted root and records integrity', async () => {
    const resolver = resolverFor({ opencode: executable });

    const resolved = await resolver.resolve('opencode', context);
    const expectedHash = createHash('sha256')
      .update(await readFile(executable))
      .digest('hex');

    expect(resolved).not.toBeNull();
    expect(resolved?.commandName).toBe('opencode');
    expect(resolved?.resolvedPath).toBe(executable);
    expect(resolved?.integrityHash).toBe(expectedHash);
  });

  it('fails closed for an unmapped alias', async () => {
    const resolver = resolverFor({ opencode: executable });
    await expect(resolver.resolve('codex', context)).resolves.toBeNull();
  });

  it('rejects shell-like command aliases', async () => {
    const resolver = resolverFor({ opencode: executable });
    await expect(resolver.resolve('opencode --auto', context)).resolves.toBeNull();
  });

  it('rejects relative executable configuration', () => {
    expect(
      () => new TrustedLocalExecutableResolver('{"opencode":"./opencode"}', dir),
    ).toThrow(/must be absolute/);
  });

  it('requires a trusted launcher root when executables are configured', () => {
    expect(
      () => new TrustedLocalExecutableResolver(JSON.stringify({ opencode: executable }), undefined),
    ).toThrow(/LAUNCHER_ROOT is required/);
  });

  it('fails closed when the mapped path is outside the trusted launcher root', async () => {
    const other = await mkdtemp(join(tmpdir(), `vito-outside-${randomUUID()}-`));
    const outsideExecutable = join(other, 'agent-tool');
    await writeFile(outsideExecutable, '#!/bin/sh\necho outside\n', 'utf8');
    await chmod(outsideExecutable, 0o755);
    try {
      const resolver = new TrustedLocalExecutableResolver(
        JSON.stringify({ opencode: outsideExecutable }),
        dir,
      );
      await expect(resolver.resolve('opencode', context)).resolves.toBeNull();
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('fails closed when the mapped path is not executable', async () => {
    await chmod(executable, 0o644);
    const resolver = resolverFor({ opencode: executable });
    await expect(resolver.resolve('opencode', context)).resolves.toBeNull();
  });
});
