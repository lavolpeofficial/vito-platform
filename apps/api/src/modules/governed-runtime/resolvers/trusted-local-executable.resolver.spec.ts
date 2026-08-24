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

  it('resolves only an explicitly mapped executable and records integrity', async () => {
    const resolver = new TrustedLocalExecutableResolver(
      JSON.stringify({ opencode: executable }),
    );

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
    const resolver = new TrustedLocalExecutableResolver(
      JSON.stringify({ opencode: executable }),
    );

    await expect(resolver.resolve('codex', context)).resolves.toBeNull();
  });

  it('rejects shell-like command aliases', async () => {
    const resolver = new TrustedLocalExecutableResolver(
      JSON.stringify({ opencode: executable }),
    );

    await expect(resolver.resolve('opencode --auto', context)).resolves.toBeNull();
  });

  it('rejects relative executable configuration', () => {
    expect(
      () => new TrustedLocalExecutableResolver('{"opencode":"./opencode"}'),
    ).toThrow(/must be absolute/);
  });

  it('fails closed when the mapped path is not executable', async () => {
    await chmod(executable, 0o644);
    const resolver = new TrustedLocalExecutableResolver(
      JSON.stringify({ opencode: executable }),
    );

    await expect(resolver.resolve('opencode', context)).resolves.toBeNull();
  });
});
