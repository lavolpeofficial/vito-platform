import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { TrustedExecutable, TrustedExecutableResolver } from '@vito/contracts';

/**
 * TrustedLocalExecutableResolver
 *
 * Resolves command aliases to an explicit admin-controlled executable map.
 * No PATH lookup, shell expansion, relative paths, aliases from the worktree,
 * or caller-controlled executable paths are accepted.
 *
 * Environment format:
 *   VITO_TRUSTED_LOCAL_EXECUTABLES='{"opencode":"/usr/local/bin/opencode","codex":"/usr/local/bin/codex"}'
 */
export class TrustedLocalExecutableResolver implements TrustedExecutableResolver {
  private readonly executableMap: ReadonlyMap<string, string>;

  constructor(rawConfig = process.env.VITO_TRUSTED_LOCAL_EXECUTABLES) {
    this.executableMap = parseExecutableMap(rawConfig);
  }

  async resolve(
    requestedCommand: string,
    _context: {
      organizationId: string;
      workflowRunId: string;
      capabilityCode: string;
      providerId: string;
    },
  ): Promise<TrustedExecutable | null> {
    if (!isSafeAlias(requestedCommand)) return null;

    const configuredPath = this.executableMap.get(requestedCommand);
    if (!configuredPath || !isAbsolute(configuredPath)) return null;

    let realPath: string;
    try {
      realPath = await fs.realpath(resolve(configuredPath));
      const stat = await fs.stat(realPath);
      if (!stat.isFile()) return null;
      await fs.access(realPath, fsConstants.X_OK);
    } catch {
      return null;
    }

    const bytes = await fs.readFile(realPath);
    const integrityHash = createHash('sha256').update(bytes).digest('hex');

    return Object.freeze({
      commandName: requestedCommand,
      resolvedPath: realPath,
      integrityHash,
      verifiedAt: new Date(),
    });
  }
}

function isSafeAlias(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value);
}

function parseExecutableMap(rawConfig: string | undefined): ReadonlyMap<string, string> {
  if (!rawConfig?.trim()) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    throw new Error('VITO_TRUSTED_LOCAL_EXECUTABLES must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('VITO_TRUSTED_LOCAL_EXECUTABLES must be a JSON object');
  }

  const entries: Array<[string, string]> = [];
  for (const [alias, executablePath] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isSafeAlias(alias)) {
      throw new Error(`Invalid trusted executable alias: ${alias}`);
    }
    if (typeof executablePath !== 'string' || !isAbsolute(executablePath)) {
      throw new Error(`Trusted executable path for ${alias} must be absolute`);
    }
    entries.push([alias, executablePath]);
  }

  return new Map(entries);
}
