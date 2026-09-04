import {
  ExecutionProfile,
  createBuilderPolicy,
  createReviewerPolicy,
  type ExecutionPolicyConfig,
  type ExecutionPolicyResolutionContext,
  type ExecutionPolicyResolver,
} from '@vito/contracts';
import { parseGovernedWorkspaceRoot } from './governed-workspace.resolvers';

/**
 * Vertrauenswürdiger TrustedExecutionPolicyResolver (EO-01.5-Schnittstelle).
 *
 * Bewusst KEIN zweiter Policy-Motor: die Auflösung delegiert 1:1 an die
 * eingefrorenen EO-01.4-Fabriken (createBuilderPolicy/createReviewerPolicy)
 * mit dem vertrauenswürdigen Workspace-Root als allowedRoot. Es werden
 * keine Command-/Pfad-Regellisten dupiziert und keine request-gelieferten
 * Policy-Objekte akzeptiert — der Resolution-Kontext trägt strukturell
 * keine Policy-Autorität.
 *
 * Fail closed: unbekannte Profil-/Capability-Kombinationen (u. a.
 * RELEASE_AUTHORITY/ORCHESTRATOR ohne Human-Gate-Bindung) ergeben null und
 * verhindern adapter.execute() vor der Ausführung.
 */
export class TrustedExecutionPolicyResolver implements ExecutionPolicyResolver {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = parseGovernedWorkspaceRoot(workspaceRoot);
  }

  async resolve(context: ExecutionPolicyResolutionContext): Promise<ExecutionPolicyConfig | null> {
    switch (context.executionProfile) {
      case ExecutionProfile.BUILDER:
        return createBuilderPolicy(this.workspaceRoot);
      case ExecutionProfile.REVIEWER:
        return createReviewerPolicy(this.workspaceRoot);
      default:
        // ORCHESTRATOR/RELEASE_AUTHORITY/unbekannt: fail closed.
        return null;
    }
  }
}
