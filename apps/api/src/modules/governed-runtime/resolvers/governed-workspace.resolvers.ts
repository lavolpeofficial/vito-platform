import { createHash } from 'crypto';
import { isAbsolute, join, normalize } from 'path';

/**
 * Governed Workspace Confinement (B2b).
 *
 * Das Workspace-Root stammt ausschließlich aus vertrauenswürdiger
 * Server-Konfiguration (absolut, normalisiert, fehlt/relativ => fail closed).
 * Die organisationsspezifische Directory ist eine deterministische
 * SHA-256-Ableitung: Tenant-Identifier können niemals Traversal-Sequenzen,
 * Separatoren oder Kollisionen nach Sanitization erzeugen. Kein echtes
 * Betriebssystem-Benutzerhome wird exponiert — die logische Home-Semantik
 * ist das organisationsscope'd Workspace-Verzeichnis selbst.
 */

export function parseGovernedWorkspaceRoot(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string' || !isAbsolute(raw)) {
    throw new Error(
      'GOVERNED_WORKSPACE_ROOT_INVALID: governed workspace root must be configured as an absolute server-side path',
    );
  }
  const normalized = normalize(raw);
  return normalized.length > 1 ? normalized.replace(/[\\/]+$/, '') : normalized;
}

/** Deterministische, traversal-unfähige Directory-Ableitung pro Organisation. */
export function governedOrgDirectoryName(organizationId: string): string {
  return createHash('sha256').update(`vito-governed-org:${organizationId}`).digest('hex');
}

function orgWorkspaceDirectory(workspaceRoot: string, organizationId: string): string {
  return join(parseGovernedWorkspaceRoot(workspaceRoot), 'orgs', governedOrgDirectoryName(organizationId));
}

/**
 * Vertrauenswürdiger WorkingDirectoryResolver (EO-01.5-Schnittstelle).
 * Rein deterministisch: keine Dateisystem-Anlage im Resolver — die
 * Verzeichnisentstehung geschieht konfiniert im Adapter.
 */
export class GovernedWorkingDirectoryResolver {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = parseGovernedWorkspaceRoot(workspaceRoot);
  }

  async resolve(context: {
    organizationId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    capabilityCode: string;
    providerId: string;
  }): Promise<string | null> {
    return orgWorkspaceDirectory(this.workspaceRoot, context.organizationId);
  }
}

/**
 * HomeDirectoryResolver gemäß der in governed-invocation.service.ts
 * definierten Schnittstelle. Logische Home-Semantik = organisationsscope'd
 * governed Workspace; niemals request-authoritativ, niemals das reale
 * Betriebssystem-Benutzerhome.
 */
export class GovernedHomeDirectoryResolver {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = parseGovernedWorkspaceRoot(workspaceRoot);
  }

  async resolve(context: {
    organizationId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    capabilityCode: string;
    providerId: string;
  }): Promise<string | null> {
    return orgWorkspaceDirectory(this.workspaceRoot, context.organizationId);
  }
}
