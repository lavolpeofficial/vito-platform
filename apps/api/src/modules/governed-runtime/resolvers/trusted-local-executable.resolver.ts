import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { isAbsolute, normalize, resolve, sep } from 'node:path';

import type { TrustedExecutable, TrustedExecutableResolver } from '@vito/contracts';

/**
 * Resolves agent command aliases to admin-installed launchers outside any
 * governed worktree. No PATH lookup, shell expansion, relative path or
 * caller-controlled executable identity is accepted.
 *
 * Productive configuration requires BOTH:
 *
 *   VITO_TRUSTED_AGENT_LAUNCHER_ROOT=/usr/local/lib/vito-agent-launchers
 *   VITO_TRUSTED_LOCAL_EXECUTABLES='{"opencode":"/usr/local/lib/vito-agent-launchers/opencode","codex":"/usr/local/lib/vito-agent-launchers/codex"}'
 *
 * The launcher root is an explicit trust boundary. Production launchers are
 * expected to establish the OS/container sandbox before starting the agent.
 */
export class TrustedLocalExecutableResolver implements TrustedExecutableResolver {
  private readonly executableMap: ReadonlyMap<string, string>;
  private readonly launcherRoot: string | null;

  constructor(
    rawConfig = process.env.VITO_TRUSTED_LOCAL_EXECUTABLES,
    rawLauncherRoot = process.env.VITO_TRUSTED_AGENT_LAUNCHER_ROOT,
  ) {
    this.executableMap = parseExecutableMap(rawConfig);
    this.launcherRoot = parseLauncherRoot(rawLauncherRoot, this.executableMap.size > 0);
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
    if (!isSafeAlias(requestedCommand) || !this.launcherRoot) return null;

    const configuredPath = this.executableMap.get(requestedCommand);
    if (!configuredPath || !isAbsolute(configuredPath)) return null;

    let realPath: string;
    let realRoot: string;
    try {
      realRoot = await fs.realpath(this.launcherRoot);
      realPath = await fs.realpath(resolve(configuredPath));
      if (!isInside(realPath, realRoot)) return null;
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

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

function isSafeAlias(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value);
}

function parseLauncherRoot(raw: string | undefined, required: boolean): string | null {
  if (!raw?.trim()) {
    if (required) {
      throw new Error(
        'VITO_TRUSTED_AGENT_LAUNCHER_ROOT is required when local executables are configured',
      );
    }
    return null;
  }
  if (!isAbsolute(raw)) {
    throw new Error('VITO_TRUSTED_AGENT_LAUNCHER_ROOT must be absolute');
  }
  const normalized = normalize(raw);
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/u, '') : normalized;
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
    if (!isSafeAlias(alias)) throw new Error(`Invalid trusted executable alias: ${alias}`);
    if (typeof executablePath !== 'string' || !isAbsolute(executablePath)) {
      throw new Error(`Trusted executable path for ${alias} must be absolute`);
    }
    entries.push([alias, executablePath]);
  }

  return new Map(entries);
}
