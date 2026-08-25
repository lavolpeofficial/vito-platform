import { Injectable, Logger } from '@nestjs/common';
import type { RegisteredRepository, RepositoryRegistry } from './types';

const VITO_01_ALLOWED_REPO = 'lavolpeofficial/vito-platform';

@Injectable()
export class EnvRepositoryRegistry implements RepositoryRegistry {
  private readonly logger = new Logger(EnvRepositoryRegistry.name);
  private readonly repositories: ReadonlyMap<string, RegisteredRepository>;

  constructor(rawConfig = process.env.VITO_REPOSITORY_REGISTRY) {
    this.repositories = parseRepositoryRegistry(rawConfig);
    this.logger.log(
      `Repository registry loaded: ${this.repositories.size} repository(ies)`,
    );
  }

  resolve(repositoryId: string): RegisteredRepository | null {
    const repo = this.repositories.get(repositoryId);
    if (!repo || !repo.enabled) return null;
    return repo;
  }

  isBaseRefAllowed(repositoryId: string, baseRef: string): boolean {
    const repo = this.resolve(repositoryId);
    if (!repo) return false;
    return repo.allowedBaseRefs.includes(baseRef);
  }
}

function parseRepositoryRegistry(
  raw: string | undefined,
): ReadonlyMap<string, RegisteredRepository> {
  if (!raw?.trim()) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('VITO_REPOSITORY_REGISTRY must be valid JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('VITO_REPOSITORY_REGISTRY must be a JSON array');
  }

  const entries: Array<[string, RegisteredRepository]> = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Each repository entry must be a JSON object');
    }
    const { repositoryId, cloneUrl, allowedBaseRefs, enabled } =
      item as Record<string, unknown>;

    if (typeof repositoryId !== 'string' || repositoryId.length === 0) {
      throw new Error('repositoryId is required and must be a non-empty string');
    }
    if (typeof cloneUrl !== 'string' || cloneUrl.length === 0) {
      throw new Error(`cloneUrl is required for repository '${repositoryId}'`);
    }
    if (
      !Array.isArray(allowedBaseRefs) ||
      allowedBaseRefs.length === 0 ||
      allowedBaseRefs.every((r: unknown) => typeof r !== 'string')
    ) {
      throw new Error(
        `allowedBaseRefs must be a non-empty string array for repository '${repositoryId}'`,
      );
    }

    entries.push([
      repositoryId,
      {
        repositoryId,
        cloneUrl,
        allowedBaseRefs: Object.freeze(allowedBaseRefs as string[]),
        registeredAt: new Date(),
        enabled: enabled !== false,
      },
    ]);
  }

  enforceV01RepositoryInvariant(entries);

  return new Map(entries);
}

/**
 * v0.1 invariant: production code authorizes exactly one repository:
 * lavolpeofficial/vito-platform. Any configuration containing additional
 * repositories must fail closed.
 */
function enforceV01RepositoryInvariant(
  entries: Array<[string, RegisteredRepository]>,
): void {
  if (entries.length === 0) {
    throw new Error(
      `VITO-REW-001 v0.1 repository invariant: exactly one repository (${VITO_01_ALLOWED_REPO}) is authorized. ` +
        `Found 0 repository entries. At least one repository must be configured.`,
    );
  }

  if (entries.length !== 1) {
    throw new Error(
      `VITO-REW-001 v0.1 repository invariant: exactly one repository (${VITO_01_ALLOWED_REPO}) is authorized. ` +
        `Found ${entries.length} repository entries. Additional repositories are not permitted.`,
    );
  }

  const [repoId] = entries[0];
  if (repoId !== VITO_01_ALLOWED_REPO) {
    throw new Error(
      `VITO-REW-001 v0.1 repository invariant: only '${VITO_01_ALLOWED_REPO}' is authorized. ` +
        `Found unauthorized repository '${repoId}'.`,
    );
  }
}
