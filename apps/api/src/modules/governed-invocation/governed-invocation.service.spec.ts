/**
 * EO-01.5 Phase 3A — Governed Invocation Policy-Boundary Tests.
 *
 * Adversarial Tests für die Trust-Boundary zwischen Routing (EO-01.3),
 * Execution Policy (EO-01.4) und Adapter-Ausführung (EO-01.5).
 *
 * Kerninvariante: Routing eligibility != execution permission != execution.
 * Der echte EO-01.4 evaluatePolicy() läuft — evaluatePolicy wird NICHT gemockt.
 *
 * Alle Constructor-Dependencies von GovernedInvocationServiceImpl werden
 * durch kontrollierte In-Memory-Fakes ersetzt. Keine echten Provider,
 * keine echten Credentials, kein Netzwerk, keine Shell, kein Git.
 */

import { GovernedInvocationServiceImpl } from './governed-invocation.service';
import type {
  HomeDirectoryResolver,
  ProviderResolver,
} from './governed-invocation.service';
import { AuditService } from '../audit/audit.service';
import {
  AgentExecutionStatus,
  createBuilderPolicy,
  createReviewerPolicy,
  ExecutionAction,
  ExecutionProfile,
  ExecutionOutcome,
  isProviderRoutable,
  ProviderCredentialRequirement,
  ProviderHealthStatus,
  ProviderQuotaStatus,
  ProviderStatus,
  ProviderType,
  providerSupportsCapability,
  ReleaseGateStatus,
  type CredentialBroker,
  type ExecutionPolicyConfig,
  type ExecutionPolicyResolutionContext,
  type ExecutionPolicyResolver,
  type ExecutionProfileResolver,
   type GovernedAdapterRegistry,
   type GovernedAdapterResult,
   type GovernedCapabilityInvocationRequest,
  type GovernedCapabilityInvocationResult,
  type GovernedExecutionContext,
  type GovernedProviderAdapter,
  type HumanGateBinding,
  type HumanGateResolver,
  type ProviderDeclaration,
  type TrustedExecutableResolver,
  type WorkingDirectoryResolver,
} from '@vito/contracts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_A = 'org-a';
const WORKFLOW_RUN_ID = 'wf-run-1';
const WORKFLOW_STEP_RUN_ID = 'wf-step-1';
const CORRELATION_ID = 'corr-1';
const CAPABILITY_CODE = 'CODE_BUILD';
/** Identisch zum etablierten Worktree-Root aus den EO-01.4 Policy-Tests. */
const WORKTREE_ROOT = '/workspace/my-project';
/** Regiertes HOME-Verzeichnis (außerhalb des Worktrees). */
const GOVERNED_HOME = '/home/governed-agent';

function makeProviderDeclaration(overrides: Record<string, any> = {}): ProviderDeclaration {
  return {
    id: 'provider-1',
    organizationId: ORG_A,
    providerCode: 'TEST_PROVIDER',
    displayName: 'Test Provider',
    providerType: ProviderType.CLOUD_LLM,
    status: ProviderStatus.ACTIVE,
    modelFamily: 'test-family',
    modelName: 'test-model',
    modelCode: 'test-model-code',
    // Legacy JSON: NICHT Routing-Authorität (nur Abwärtskompatibilität).
    supportedCapabilities: [CAPABILITY_CODE],
    // Durable Assignments sind alleinige Routing-Authorität.
    capabilityAssignments: [
      { capabilityCode: CAPABILITY_CODE, isEnabled: true },
    ],
    estimatedCostMinorUnits: null,
    healthStatus: ProviderHealthStatus.HEALTHY,
    healthCheckedAt: new Date(),
    quotaStatus: ProviderQuotaStatus.AVAILABLE,
    quotaCheckedAt: new Date(),
    qualityScore: 0.9,
    latencyScore: 1000,
    costScore: 100,
    costMetadata: {},
    assuranceLevels: ['AL1', 'AL2', 'AL3', 'AL4'],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    credentialRequirement: ProviderCredentialRequirement.NOT_REQUIRED,
    ...overrides,
  };
}

/**
 * Gültiger Request mit einer Konfiguration, die EO-01.4 erlauben würde:
 * BUILDER + READ_FILE innerhalb des zugewiesenen Worktrees
 * (etablierter ALLOW-Fall aus execution-policy.spec.ts, Test 1).
 */
function makeInvocationRequest(overrides: Record<string, any> = {}): GovernedCapabilityInvocationRequest {
  return {
    invocationId: 'inv-1',
    organizationId: ORG_A,
    workflowRunId: WORKFLOW_RUN_ID,
    workflowStepRunId: WORKFLOW_STEP_RUN_ID,
    correlationId: CORRELATION_ID,
    capabilityCode: CAPABILITY_CODE,
    providerId: 'provider-1',
    executionProfile: ExecutionProfile.BUILDER,
    inputReference: 'gov://input/1',
    executionBudget: { maxDurationMs: 60000, maxTokens: 100000 },
    requestedAction: ExecutionAction.READ_FILE,
    requestedPath: `${WORKTREE_ROOT}/src/index.ts`,
    requestedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Controlled in-memory fakes
// ---------------------------------------------------------------------------

interface FakeAdapter {
  adapter: GovernedProviderAdapter;
  execute: jest.Mock;
}

function buildFakeAdapter(providerType: ProviderType): FakeAdapter {
  const execute = jest.fn().mockImplementation(async () => ({
    status: AgentExecutionStatus.SUCCEEDED,
    outputReference: 'gov://output/fake-result',
    artifactReferences: [],
    evidenceReferences: [],
    providerExecutionMetadata: {},
    completedAt: new Date(),
  }));
  const adapter: GovernedProviderAdapter = { providerType, execute };
  return { adapter, execute };
}

function buildFakeAdapterRegistry(adapter: GovernedProviderAdapter): GovernedAdapterRegistry {
  const adapters = new Map<ProviderType, GovernedProviderAdapter>([
    [adapter.providerType, adapter],
  ]);
  return {
    register: jest.fn(),
    get: (providerType) => adapters.get(providerType),
    has: (providerType) => adapters.has(providerType),
    getSupportedProviderTypes: () => Array.from(adapters.keys()),
  };
}

function buildFakeProviderResolver(provider: ProviderDeclaration | null): ProviderResolver {
  return {
    resolve: jest.fn().mockResolvedValue(provider),
  };
}

function buildFakeAuditService(): AuditService {
  return {
    record: jest.fn().mockResolvedValue({ id: 'audit-event-1' }),
  } as unknown as AuditService;
}

function buildFakeHumanGateResolver(): HumanGateResolver {
  return {
    resolve: jest.fn().mockResolvedValue(null),
  };
}

function buildFakeCredentialBroker(): CredentialBroker {
  return {
    getCredentialReference: jest.fn().mockResolvedValue('cred-ref-1'),
    validateCredentialReference: jest.fn().mockResolvedValue(true),
  };
}

function buildFakeTrustedExecutableResolver(): TrustedExecutableResolver {
  return {
    resolve: jest.fn().mockResolvedValue({
      commandName: 'git',
      resolvedPath: '/usr/bin/git',
      verifiedAt: new Date(),
    }),
  };
}

function buildFakeWorkingDirectoryResolver(): WorkingDirectoryResolver {
  return {
    resolve: jest.fn().mockResolvedValue(WORKTREE_ROOT),
  };
}

function buildFakeHomeDirectoryResolver(): HomeDirectoryResolver {
  return {
    resolve: jest.fn().mockResolvedValue(GOVERNED_HOME),
  };
}

/**
 * Trusted ExecutionProfileResolver-Fake.
 *
 * Modelliert die AUTHORITATIVE Profil-Bindung des Workflow-Step-Runs aus
 * vertrauenswürdigem Runtime-Kontext. KEIN Echo des caller-kontrollierten
 * Request-Hinweises: Der Rückgabewert bestimmt allein das effektive Profil.
 * Default: BUILDER (identisch zum Standard-Fixture-Kontext).
 */
function buildFakeExecutionProfileResolver(
  profile: ExecutionProfile = ExecutionProfile.BUILDER,
): ExecutionProfileResolver & { resolve: jest.Mock } {
  return {
    resolve: jest.fn().mockResolvedValue(profile),
  };
}

/**
 * Trusted ExecutionPolicyResolver-Fake.
 *
 * KEIN permissives "allowed=true"-Fake: Er liefert eine echte
 * ExecutionPolicyConfig (identisch zum etablierten BUILDER-Policy-Fall aus
 * execution-policy.spec.ts), die ausschließlich vom echten EO-01.4
 * evaluatePolicy() konsumiert wird.
 */
function buildFakeExecutionPolicyResolver(
  policy: ExecutionPolicyConfig = createBuilderPolicy(WORKTREE_ROOT),
): ExecutionPolicyResolver & { resolve: jest.Mock } {
  return {
    resolve: jest.fn().mockResolvedValue(policy),
  };
}

interface Harness {
  service: GovernedInvocationServiceImpl;
  providerResolver: ProviderResolver;
  adapterRegistry: GovernedAdapterRegistry;
  fakeAdapter: FakeAdapter;
  auditService: AuditService;
  humanGateResolver: HumanGateResolver;
  credentialBroker: CredentialBroker;
  trustedExecutableResolver: TrustedExecutableResolver;
  workingDirectoryResolver: WorkingDirectoryResolver;
  homeDirectoryResolver: HomeDirectoryResolver;
  executionProfileResolver: ExecutionProfileResolver & { resolve: jest.Mock };
  executionPolicyResolver: ExecutionPolicyResolver & { resolve: jest.Mock };
}

function buildHarness(overrides: Partial<Record<string, any>> = {}): Harness {
  const provider = overrides.provider ?? makeProviderDeclaration();
  const fakeAdapter = overrides.fakeAdapter ?? buildFakeAdapter(ProviderType.CLOUD_LLM);

  const providerResolver =
    overrides.providerResolver ?? buildFakeProviderResolver(provider);
  const adapterRegistry =
    overrides.adapterRegistry ?? buildFakeAdapterRegistry(fakeAdapter.adapter);
  const auditService = overrides.auditService ?? buildFakeAuditService();
  const humanGateResolver =
    overrides.humanGateResolver ?? buildFakeHumanGateResolver();
  // Expliziter undefined-Vergleich (statt ??): Test 8 injiziert bewusst
  // credentialBroker = null; `??` würde das stillschweigend zum Fake-Broker
  // kollabieren und die Fail-closed-Prämisse des Tests zerstören.
  const credentialBroker =
    overrides.credentialBroker !== undefined
      ? overrides.credentialBroker
      : buildFakeCredentialBroker();
  const trustedExecutableResolver =
    overrides.trustedExecutableResolver ?? buildFakeTrustedExecutableResolver();
  const workingDirectoryResolver =
    overrides.workingDirectoryResolver ?? buildFakeWorkingDirectoryResolver();
  const homeDirectoryResolver =
    overrides.homeDirectoryResolver ?? buildFakeHomeDirectoryResolver();
  const executionProfileResolver =
    overrides.executionProfileResolver ?? buildFakeExecutionProfileResolver();
  const executionPolicyResolver =
    overrides.executionPolicyResolver ?? buildFakeExecutionPolicyResolver();

  const service = new GovernedInvocationServiceImpl({
    providerResolver,
    adapterRegistry,
    credentialBroker,
    auditService,
    trustedExecutableResolver,
    workingDirectoryResolver,
    humanGateResolver,
    homeDirectoryResolver,
    executionProfileResolver,
    executionPolicyResolver,
  });

  return {
    service,
    providerResolver,
    adapterRegistry,
    fakeAdapter,
    auditService,
    humanGateResolver,
    credentialBroker,
    trustedExecutableResolver,
    workingDirectoryResolver,
    homeDirectoryResolver,
    executionProfileResolver,
    executionPolicyResolver,
  };
}

// ===========================================================================
// 1. EO-01.4 erlaubt Ausführung → Adapter wird genau einmal aufgerufen
// ===========================================================================

describe('GovernedInvocationServiceImpl policy boundary', () => {
  it('calls adapter exactly once after EO-01.4 allows execution', async () => {
    const harness = buildHarness();
    // Etablierter ALLOW-Fall: BUILDER + READ_FILE im Worktree (EO-01.4 Test 1).
    const request = makeInvocationRequest();

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);

    // Allow-Nachweis: Das echte EO-01.4 evaluatePolicy() hat auf Basis der
    // vertrauenswürdig aufgelösten ExecutionPolicyConfig erlaubt.
    const [adapterRequest, executionContext] = harness.fakeAdapter.execute.mock
      .calls[0];
    expect(adapterRequest.inputReference).toBe('gov://input/1');
    expect(executionContext.policyDecision.allowed).toBe(true);
    expect(executionContext.organizationId).toBe(ORG_A);
  });

  // =========================================================================
  // 2. EO-01.4 verweigert Ausführung → Adapter wird nie aufgerufen
  // =========================================================================

  it('does not call adapter when EO-01.4 denies execution', async () => {
    const harness = buildHarness({
      executionProfileResolver: buildFakeExecutionProfileResolver(ExecutionProfile.REVIEWER),
    });
    // Etablierter DENY-Fall: REVIEWER + WRITE_FILE (EO-01.4 Test 11,
    // REVIEWER_WRITE_DENIED — unabhängig vom Pfad deterministisch verweigert).
    // Der Workflow-Step-Run IST ein Reviewer-Kontext → der trusted
    // ExecutionProfileResolver liefert REVIEWER (nicht den Request-Hinweis).
    const request = makeInvocationRequest({
      invocationId: 'inv-denied-1',
      executionProfile: ExecutionProfile.REVIEWER,
      requestedAction: ExecutionAction.WRITE_FILE,
      requestedPath: `${WORKTREE_ROOT}/src/module.ts`,
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(result.normalizedError?.executionOutcome).toBe(
      ExecutionOutcome.POLICY_BLOCKED,
    );
    expect(result.policyDecisionReference).toContain('eo-01.4');
  });

  // =========================================================================
  // 3. Routing-Eligibility autorisiert allein KEINE Ausführung
  // =========================================================================

  it('routing eligibility alone does not authorize execution', async () => {
    const provider = makeProviderDeclaration();
    const harness = buildHarness({ provider });
    // Provider ist sonst voll routing-berechtigt (EO-01.3):
    // ACTIVE + HEALTHY + AVAILABLE + enabled Capability + gleiche Organisation.

    // Trotzdem verweigert EO-01.4 deterministisch:
    // BUILDER + GIT_MERGE (EO-01.4 Test 17, in v0.1 bedingungslos denied).
    const request = makeInvocationRequest({
      invocationId: 'inv-routing-vs-policy-1',
      requestedAction: ExecutionAction.GIT_MERGE,
    });

    const resolved = await harness.providerResolver.resolve(
      request.providerId,
      request.organizationId,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe(ProviderStatus.ACTIVE);
    expect(resolved!.healthStatus).toBe(ProviderHealthStatus.HEALTHY);
    expect(resolved!.quotaStatus).toBe(ProviderQuotaStatus.AVAILABLE);
    expect(isProviderRoutable(resolved!)).toBe(true);
    expect(providerSupportsCapability(resolved!, CAPABILITY_CODE)).toBe(true);

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(result.normalizedError?.executionOutcome).toBe(
      ExecutionOutcome.POLICY_BLOCKED,
    );
  });

  // =========================================================================
  // 4. Caller kann KEINE PolicyDecision-Authorität einschleppen
  // =========================================================================

  it('caller cannot supply PolicyDecision authority', async () => {
    // Reviewer-Kontext → trusted ExecutionProfileResolver liefert REVIEWER.
    const harness = buildHarness({
      executionProfileResolver: buildFakeExecutionProfileResolver(ExecutionProfile.REVIEWER),
    });

    // Der typisierte Request enthält per Contract kein policyDecision-Feld.
    const normalRequest = makeInvocationRequest();
    expect('policyDecision' in normalRequest).toBe(false);

    // Runtime-Manipulation: Caller schleppt ein gefälschtes ALLOW-Decision ein.
    const tamperedRequest: Record<string, unknown> = {
      ...makeInvocationRequest({
        invocationId: 'inv-tampered-1',
        executionProfile: ExecutionProfile.REVIEWER,
        requestedAction: ExecutionAction.WRITE_FILE,
        requestedPath: `${WORKTREE_ROOT}/src/module.ts`,
      }),
      policyDecision: { allowed: true },
    };

    const result = await harness.service.invoke(
      tamperedRequest as unknown as GovernedCapabilityInvocationRequest,
    );

    // Das eingeschmuggelte Feld darf Autorisierung nicht beeinflussen:
    // EO-01.4 entscheidet intern und verweigert weiterhin.
    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
  });

  // =========================================================================
  // 5. Gefälschte Human-Approval-Reference erzeugt KEINE Release-Authority
  // =========================================================================

  it('forged human approval reference cannot create release authority', async () => {
    // Aufsetz-Szenario: EO-01.4 würde GIT_COMMIT für RELEASE_AUTHORITY genau
    // dann erlauben, wenn der Release Gate APPROVED wäre. Provider und Policy
    // sind sonst gültig/routbar — der einzige Angriffsvektor ist die
    // caller-kontrollierte humanApprovalReference.
    const releasePolicy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitCommit: true,
    };
    const harness = buildHarness({
      executionPolicyResolver: buildFakeExecutionPolicyResolver(releasePolicy),
    });
    // Default-Fake: Trusted HumanGateResolver kennt die Reference nicht → null.

    const request = makeInvocationRequest({
      invocationId: 'inv-forged-approval-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      requestedPath: undefined,
      humanApprovalReference: 'forged-release-ref',
    });

    const result = await harness.service.invoke(request);

    // Die Reference wurde vertrauenswürdig aufgelöst (und dabei abgelehnt) —
    // niemals direkt als APPROVED übernommen.
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledWith(
      'forged-release-ref',
      expect.objectContaining({
        organizationId: ORG_A,
        workflowStepRunId: WORKFLOW_STEP_RUN_ID,
        capabilityCode: CAPABILITY_CODE,
      }),
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(result.normalizedError?.executionOutcome).toBe(
      ExecutionOutcome.POLICY_BLOCKED,
    );
    // Kein caller-kontrollierter Wert wurde zu ReleaseGateStatus.APPROVED erhoben.
    expect(JSON.stringify(result)).not.toContain(ReleaseGateStatus.APPROVED);
  });

  // =========================================================================
  // 6. Human-Genehmigung aus fremdem Invocation-Kontext wird verworfen
  // =========================================================================

  it('human approval bound to another invocation context is rejected', async () => {
    const releasePolicy: ExecutionPolicyConfig = {
      ...createBuilderPolicy(WORKTREE_ROOT),
      allowGitCommit: true,
    };
    // Authentisches Binding aus dem TRUSTED Store — aber an einen anderen
    // Invocation-Kontext gebunden (fremde workflowStepRunId).
    const foreignContextBinding: HumanGateBinding = {
      approvalId: 'approval-other-step',
      organizationId: ORG_A,
      workflowRunId: WORKFLOW_RUN_ID,
      workflowStepRunId: 'wf-step-OTHER-invocation',
      capabilityCode: CAPABILITY_CODE,
      providerId: 'provider-1',
      approverIdentity: 'human-approver-a',
      approvedAt: new Date(),
    };
    const harness = buildHarness({
      executionPolicyResolver: buildFakeExecutionPolicyResolver(releasePolicy),
    });
    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      foreignContextBinding,
    );

    const request = makeInvocationRequest({
      invocationId: 'inv-approval-mismatch-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      requestedPath: undefined,
      humanApprovalReference: 'release-ref-bound-elsewhere',
    });

    const result = await harness.service.invoke(request);

    expect(harness.humanGateResolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    // Das fremd-gebundene Approval darf den Gate NICHT auf APPROVED heben.
    expect(JSON.stringify(result)).not.toContain(ReleaseGateStatus.APPROVED);
  });

  // =========================================================================
  // 7. UNKNOWN Credential Requirement — fail closed vor Adapter-Ausführung
  // =========================================================================

  it('unknown provider credential requirement fails closed before adapter execution', async () => {
    // Sonst vollständig gültiger, routing-berechtigter Provider im
    // etablierten ALLOW-Fall (BUILDER + READ_FILE im Worktree).
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.UNKNOWN,
    });
    const harness = buildHarness({ provider });
    expect(isProviderRoutable(provider)).toBe(true);

    const request = makeInvocationRequest({
      invocationId: 'inv-cred-unknown-1',
    });

    // Aktuelles Service-Verhalten: Fail closed als Reject VOR adapter.execute().
    await expect(harness.service.invoke(request)).rejects.toThrow(
      'CREDENTIAL_INJECTION_FAILED',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    // UNKNOWN darf nie wie NOT_REQUIRED behandelt werden: Es gab keinen
    // stillschweigenden Credential-Fallback über den Broker.
    expect(harness.credentialBroker.getCredentialReference).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 8. REQUIRED Credentials ohne trusted Broker — fail closed
  // =========================================================================

  it('required provider credentials without trusted broker fail closed', async () => {
    // Sonst gültiger ALLOW-Fall; credentialBroker ist bewusst NICHT konfiguriert.
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const harness = buildHarness({ provider, credentialBroker: null });

    const request = makeInvocationRequest({
      invocationId: 'inv-cred-required-no-broker-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'CREDENTIAL_INJECTION_FAILED: Credential broker not configured',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    // Es wurde keine synthetische/fake Credential-Reference erzeugt:
    // Kein Broker konfiguriert, keine Reference generiert.
    expect(harness.credentialBroker).toBeNull();
  });
});

// ===========================================================================
// EO-01.5 Phase 3B — Adversarial Human-Gate + Credential Boundary Tests
//
// Sicherheitsinvarianten:
// - Der echte EO-01.4 evaluatePolicy() läuft (nicht gemockt).
// - Human-Approval-Authorität stammt ausschließlich aus dem trusted
//   HumanGateResolver; die caller-kontrollierte humanApprovalReference ist
//   nur ein Lookup-Schlüssel und niemals selbst Authorität.
// - Credential-Authorität stammt ausschließlich aus dem trusted
//   CredentialBroker. REQUIRED/UNKNOWN fail closed.
// ===========================================================================

/**
 * Strukturell gültiges, nicht abgelaufenes HumanGateBinding aus dem
 * TRUSTED Store — standardmäßig vollständig an den Invocation-Kontext
 * gebunden (Org/Run/Step/Capability/Provider/Input).
 */
function makeMatchingHumanGateBinding(
  overrides: Record<string, any> = {},
): HumanGateBinding {
  return {
    approvalId: 'approval-binding-1',
    organizationId: ORG_A,
    workflowRunId: WORKFLOW_RUN_ID,
    workflowStepRunId: WORKFLOW_STEP_RUN_ID,
    capabilityCode: CAPABILITY_CODE,
    providerId: 'provider-1',
    inputReference: 'gov://input/1',
    approverIdentity: 'human-approver-a',
    approvedAt: new Date(),
    ...overrides,
  };
}

/**
 * Release-Gate-Szenario: EO-01.4 erlaubt GIT_COMMIT für RELEASE_AUTHORITY
 * genau dann, wenn allowGitCommit gesetzt UND releaseGateStatus APPROVED ist.
 * Der Gate-Status kann ausschließlich über das trusted HumanGateBinding
 * entstehen — niemals über den Caller.
 */
function buildReleaseGateHarness(): Harness {
  const releasePolicy: ExecutionPolicyConfig = {
    ...createBuilderPolicy(WORKTREE_ROOT),
    allowGitCommit: true,
  };
  return buildHarness({
    executionPolicyResolver: buildFakeExecutionPolicyResolver(releasePolicy),
    // Legitimer Release-Kontext: Der Workflow-Step-Run IST eine
    // Release-Authority-Stufe → der trusted ExecutionProfileResolver liefert
    // RELEASE_AUTHORITY aus Runtime-Bindung (nicht aus dem Request).
    executionProfileResolver: buildFakeExecutionProfileResolver(
      ExecutionProfile.RELEASE_AUTHORITY,
    ),
  });
}

function makeReleaseGateRequest(
  overrides: Record<string, any> = {},
): GovernedCapabilityInvocationRequest {
  return makeInvocationRequest({
    executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
    requestedAction: ExecutionAction.GIT_COMMIT,
    requestedPath: undefined,
    ...overrides,
  });
}

describe('GovernedInvocationServiceImpl Phase 3B trust boundaries', () => {
  // =========================================================================
  // A. Human-Gate Trust Boundary
  // =========================================================================

  it('approval reference alone does not grant authority', async () => {
    // Trusted Resolver kennt die Reference NICHT → null (Default-Fake).
    const harness = buildReleaseGateHarness();

    const request = makeReleaseGateRequest({
      invocationId: 'inv-hg-ref-alone-1',
      humanApprovalReference: 'approval-ref-1',
    });

    const result = await harness.service.invoke(request);

    // Die Reference wurde vertrauenswürdig aufgelöst (Ergebnis: null) —
    // der bloße caller-kontrollierte String erzeugt keine Release-Authority.
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledWith(
      'approval-ref-1',
      expect.objectContaining({
        organizationId: ORG_A,
        workflowRunId: WORKFLOW_RUN_ID,
        workflowStepRunId: WORKFLOW_STEP_RUN_ID,
        capabilityCode: CAPABILITY_CODE,
      }),
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    // Kein caller-kontrollierter Wert wurde zu APPROVED erhoben.
    expect(JSON.stringify(result)).not.toContain(ReleaseGateStatus.APPROVED);
  });

  it('mismatched trusted human approval does not authorize execution', async () => {
    const harness = buildReleaseGateHarness();
    // Authentisches Binding aus dem TRUSTED Store — aber an einen fremden
    // Invocation-Kontext gebunden (fremde workflowStepRunId).
    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-other-step',
        workflowStepRunId: 'wf-step-OTHER-invocation',
      }),
    );

    const request = makeReleaseGateRequest({
      invocationId: 'inv-hg-mismatch-1',
      humanApprovalReference: 'release-ref-bound-elsewhere',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(result.normalizedError?.executionOutcome).toBe(
      ExecutionOutcome.POLICY_BLOCKED,
    );
    expect(JSON.stringify(result)).not.toContain(ReleaseGateStatus.APPROVED);
  });

  it('expired trusted human approval does not authorize execution', async () => {
    const harness = buildReleaseGateHarness();
    // Binding matcht kontextuell vollständig — aber expiresAt liegt in der Vergangenheit.
    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-expired',
        approvedAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );

    const request = makeReleaseGateRequest({
      invocationId: 'inv-hg-expired-1',
      humanApprovalReference: 'release-ref-expired',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(JSON.stringify(result)).not.toContain(ReleaseGateStatus.APPROVED);
  });

  it('matching trusted human approval can satisfy EO-01.4 release gate', async () => {
    const harness = buildReleaseGateHarness();
    // Vollständig gebundenes, nicht abgelaufenes Binding aus dem TRUSTED Store:
    // organizationId, workflowRunId, workflowStepRunId, capabilityCode,
    // providerId und inputReference matchen exakt den Invocation-Kontext.
    const matchingBinding = makeMatchingHumanGateBinding({
      approvalId: 'approval-matching',
      expiresAt: new Date(Date.now() + 600_000),
    });
    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      matchingBinding,
    );

    const request = makeReleaseGateRequest({
      invocationId: 'inv-hg-matching-1',
      humanApprovalReference: 'release-ref-valid',
    });

    const result = await harness.service.invoke(request);

    // Trusted Evidence wurde aufgelöst und in EO-01.4-Policy-Kontext transformiert.
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledTimes(1);
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledWith(
      'release-ref-valid',
      expect.objectContaining({
        organizationId: ORG_A,
        workflowRunId: WORKFLOW_RUN_ID,
        workflowStepRunId: WORKFLOW_STEP_RUN_ID,
        capabilityCode: CAPABILITY_CODE,
        providerId: 'provider-1',
        inputReference: 'gov://input/1',
      }),
    );

    // Nur das echte EO-01.4 evaluatePolicy() durfte auf Basis des validierten
    // Bindings autorisieren — genau ein produktiver Adapter-Aufruf.
    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).not.toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);

    const [, executionContext] = harness.fakeAdapter.execute.mock.calls[0];
    expect(executionContext.policyDecision.allowed).toBe(true);
    expect(executionContext.policyDecision.reasonCode).toBe('POLICY_ALLOWED');
  });

  // =========================================================================
  // B. Credential Trust Boundary
  // =========================================================================

  it('required credentials fail closed when broker is missing', async () => {
    // Sonst erlaubte Invocation (BUILDER + READ_FILE im Worktree),
    // Provider verlangt Credentials, aber kein trusted Broker konfiguriert.
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const harness = buildHarness({ provider, credentialBroker: null });

    const request = makeInvocationRequest({
      invocationId: 'inv-cred-broker-missing-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'CREDENTIAL_INJECTION_FAILED: Credential broker not configured',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
  });

  it('unknown credential requirement fails closed', async () => {
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.UNKNOWN,
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-cred-unknown-fc-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'CREDENTIAL_INJECTION_FAILED',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    // UNKNOWN darf nie stillschweigend wie NOT_REQUIRED behandelt werden:
    // Es fand kein Credential-Fallback über den Broker statt.
    expect(harness.credentialBroker.getCredentialReference).not.toHaveBeenCalled();
  });

  it('required credentials fail closed when broker returns no reference', async () => {
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const broker: CredentialBroker = {
      getCredentialReference: jest.fn().mockResolvedValue(null),
      validateCredentialReference: jest.fn().mockResolvedValue(true),
    };
    const harness = buildHarness({ provider, credentialBroker: broker });

    const request = makeInvocationRequest({
      invocationId: 'inv-cred-null-ref-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'CREDENTIAL_INJECTION_FAILED',
    );

    expect(broker.getCredentialReference).toHaveBeenCalledWith(
      'provider-1',
      ORG_A,
    );
    // Keine Reference → keine Validierung → keine Ausführung.
    expect(broker.validateCredentialReference).not.toHaveBeenCalled();
    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
  });

  it('required credentials fail closed when credential reference is invalid', async () => {
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const broker: CredentialBroker = {
      getCredentialReference: jest.fn().mockResolvedValue('stale-cred-ref'),
      validateCredentialReference: jest.fn().mockResolvedValue(false),
    };
    const harness = buildHarness({ provider, credentialBroker: broker });

    const request = makeInvocationRequest({
      invocationId: 'inv-cred-invalid-ref-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'CREDENTIAL_INJECTION_FAILED',
    );

    expect(broker.validateCredentialReference).toHaveBeenCalledTimes(1);
    expect(broker.validateCredentialReference).toHaveBeenCalledWith(
      'stale-cred-ref',
    );
    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
  });

  it('valid credential reference permits execution but is not leaked', async () => {
    const SECRET_REFERENCE = 'trusted-secret-reference-123';

    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const broker: CredentialBroker = {
      getCredentialReference: jest.fn().mockResolvedValue(SECRET_REFERENCE),
      validateCredentialReference: jest.fn().mockResolvedValue(true),
    };

    // Der Adapter DARF die Reference am Adapter-Boundary sehen und prüft sie;
    // er leakt sie bewusst NICHT zurück in Result-Metadaten.
    let observedCredentialReference: string | undefined;
    const execute = jest.fn().mockImplementation(
      async (
        _request: unknown,
        context: GovernedExecutionContext,
      ): Promise<{
        status: AgentExecutionStatus;
        outputReference: string;
        artifactReferences: never[];
        evidenceReferences: never[];
        providerExecutionMetadata: Record<string, never>;
        completedAt: Date;
      }> => {
        observedCredentialReference = context.credentialReference;
        return {
          status: AgentExecutionStatus.SUCCEEDED,
          outputReference: 'gov://output/fake-result',
          artifactReferences: [],
          evidenceReferences: [],
          providerExecutionMetadata: {},
          completedAt: new Date(),
        };
      },
    );
    const fakeAdapter = {
      adapter: { providerType: ProviderType.CLOUD_LLM, execute } as GovernedProviderAdapter,
      execute,
    };

    const harness = buildHarness({ provider, credentialBroker: broker, fakeAdapter });

    const result: GovernedCapabilityInvocationResult =
      await harness.service.invoke(
        makeInvocationRequest({
          invocationId: 'inv-cred-valid-leak-1',
        }),
      );

    // Genau ein produktiver Adapter-Aufruf mit gültiger Reference am Boundary.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(observedCredentialReference).toBe(SECRET_REFERENCE);

    // Die serialisierte Invocation-Result darf die Reference NIEMALS enthalten.
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(SECRET_REFERENCE);

    // Audit-sichtbare Payloads dürfen die Reference ebenfalls NIEMALS enthalten.
    const auditRecordMock = harness.auditService.record as unknown as jest.Mock;
    for (const call of auditRecordMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_REFERENCE);
    }

    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });
});

// ===========================================================================
// EO-01.5 Phase 3B.1 — Authority-Profile Escalation Tests
//
// Invariante unter Test: BUILDER, REVIEWER und ORCHESTRATOR dürfen
// RELEASE_AUTHORITY NICHT allein durch die Auswahl von
// ExecutionProfile.RELEASE_AUTHORITY im Invocation-Input erlangen.
//
// Detection-Semantik (laut Task):
// - Existiert Architektur A/B/C (trusted runtime-derived profile, trusted
//   Profil-Bindung vor evaluatePolicy() oder ein bestehendes
//   Authority-Mechanismus), dann MÜSSEN die Tests 1–4 unten bestehen.
// - Schlagen sie fehl, ist executionProfile ein caller-kontrolliertes
//   Authorization-Input und Profile-Eskalation ist REAL. Diese Fehler sind
//   die geforderte Defekt-Evidenz und werden bewusst NICHT versteckt,
//   geskippt oder abgeschwächt.
//
// Modeling-Hinweis (Phase 3B.2 korrigiert): Das effektive ExecutionProfile
// stammt ausschließlich aus dem trusted ExecutionProfileResolver
// (Runtime-/Workflow-Step-Bindung). Der caller-kontrollierte
// request.executionProfile-Hinweis ist nicht autoritativ und erreicht den
// EO-01.4-Policy-Kontext nicht. Die Eskalationstests halten den Angriff
// konstant (Claim RELEASE_AUTHORITY im Request) und injizieren pro Fall das
// WAHRE Profil als trusted Resolver-Ergebnis: BUILDER/REVIEWER/ORCHESTRATOR
// müssen fail closed, ein genuiner RELEASE_AUTHORITY-Kontext mit gültigem
// Human Gate bleibt positivkontrollfähig.
// ===========================================================================

function buildProfileDerivedPolicyResolver(): ExecutionPolicyResolver & { resolve: jest.Mock } {
  const resolve = jest.fn(
    async (
      context: ExecutionPolicyResolutionContext,
    ): Promise<ExecutionPolicyConfig | null> => {
      switch (context.executionProfile) {
        case ExecutionProfile.RELEASE_AUTHORITY:
          return {
            ...createBuilderPolicy(WORKTREE_ROOT),
            allowGitCommit: true,
            allowGitPush: true,
          };
        case ExecutionProfile.REVIEWER:
          return createReviewerPolicy(WORKTREE_ROOT);
        default:
          return createBuilderPolicy(WORKTREE_ROOT);
      }
    },
  );
  return { resolve };
}

describe('GovernedInvocationServiceImpl Phase 3B.1 authority-profile escalation', () => {
  function buildEscalationHarness(trustedProfile: ExecutionProfile): Harness {
    return buildHarness({
      executionPolicyResolver: buildProfileDerivedPolicyResolver(),
      executionProfileResolver: buildFakeExecutionProfileResolver(trustedProfile),
    });
  }

  async function proveTrueProfileWouldDenyGitMutation(
    resolver: ExecutionPolicyResolver & { resolve: jest.Mock },
    trueProfile: ExecutionProfile,
  ): Promise<void> {
    const trueProfilePolicy = await resolver.resolve({
      organizationId: ORG_A,
      workflowRunId: WORKFLOW_RUN_ID,
      workflowStepRunId: `${WORKFLOW_STEP_RUN_ID}-counterfactual`,
      capabilityCode: CAPABILITY_CODE,
      providerId: 'provider-1',
      executionProfile: trueProfile,
      requestedAction: ExecutionAction.GIT_COMMIT,
    });
    expect(trueProfilePolicy?.allowGitCommit).toBe(false);
  }

  function latestResolverCall(
    resolver: ExecutionPolicyResolver & { resolve: jest.Mock },
  ): ExecutionPolicyResolutionContext {
    const calls = resolver.resolve.mock.calls as unknown as Array<
      [ExecutionPolicyResolutionContext]
    >;
    return calls[calls.length - 1][0];
  }

  // =========================================================================
  // Adversarial Case 1 — BUILDER-Kontext beansprucht RELEASE_AUTHORITY
  // =========================================================================

  it('BUILDER-context invocation claiming RELEASE_AUTHORITY must fail closed before adapter.execute()', async () => {
    // WAHRE Runtime-Bindung dieses Step-Runs: BUILDER.
    const harness = buildEscalationHarness(ExecutionProfile.BUILDER);

    // Kontrafaktur: Mit dem WAHREN Profil (BUILDER) würde der Trusted-
    // Policy-Kanal GIT_COMMIT deterministisch verweigern.
    await proveTrueProfileWouldDenyGitMutation(
      harness.executionPolicyResolver,
      ExecutionProfile.BUILDER,
    );

    // Trusted Store liefert ein vollständig gebundenes, gültiges Approval —
    // identische Gate-Bedingungen wie im legitimen Release-Fall.
    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-esc-builder',
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );

    // Angriff: Kompromittierter/fehlerhafter BUILDER-Caller deklariert
    // RELEASE_AUTHORITY. Der Hinweis bleibt im Request konstant — er darf
    // die Profil-Autorität nicht beeinflussen.
    const request = makeInvocationRequest({
      invocationId: 'inv-esc-builder-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      requestedPath: undefined,
      humanApprovalReference: 'release-ref-valid',
    });
    expect(request.executionProfile).toBe(ExecutionProfile.RELEASE_AUTHORITY);

    const result = await harness.service.invoke(request);

    // Evidenz der Trust-Boundary: Der trusted ExecutionProfileResolver wurde
    // befragt; im EO-01.4-Policy-Kontext steht ausschließlich das
    // autoritative BUILDER-Profil — NIEMALS der RELEASE_AUTHORITY-Claim.
    expect(harness.executionProfileResolver.resolve).toHaveBeenCalledTimes(1);
    expect(
      latestResolverCall(harness.executionPolicyResolver).executionProfile,
    ).toBe(ExecutionProfile.BUILDER);

    // Sichere Erwartung: Fail closed VOR adapter.execute().
    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
  });

  // =========================================================================
  // Adversarial Case 2 — REVIEWER-Kontext beansprucht RELEASE_AUTHORITY
  // =========================================================================

  it('REVIEWER-context invocation claiming RELEASE_AUTHORITY must fail closed before adapter.execute()', async () => {
    // WAHRE Runtime-Bindung dieses Step-Runs: REVIEWER.
    const harness = buildEscalationHarness(ExecutionProfile.REVIEWER);

    await proveTrueProfileWouldDenyGitMutation(
      harness.executionPolicyResolver,
      ExecutionProfile.REVIEWER,
    );

    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-esc-reviewer',
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );

    const request = makeInvocationRequest({
      invocationId: 'inv-esc-reviewer-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      requestedPath: undefined,
      humanApprovalReference: 'release-ref-valid',
    });

    const result = await harness.service.invoke(request);

    // Der Claim hat den Policy-Kanal nicht erreicht — autoritativ bleibt REVIEWER.
    expect(harness.executionProfileResolver.resolve).toHaveBeenCalledTimes(1);
    expect(
      latestResolverCall(harness.executionPolicyResolver).executionProfile,
    ).toBe(ExecutionProfile.REVIEWER);

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
  });

  // =========================================================================
  // Adversarial Case 3 — ORCHESTRATOR-Kontext beansprucht RELEASE_AUTHORITY
  // =========================================================================

  it('ORCHESTRATOR-context invocation claiming RELEASE_AUTHORITY must fail closed before adapter.execute()', async () => {
    // WAHRE Runtime-Bindung dieses Step-Runs: ORCHESTRATOR.
    const harness = buildEscalationHarness(ExecutionProfile.ORCHESTRATOR);

    await proveTrueProfileWouldDenyGitMutation(
      harness.executionPolicyResolver,
      ExecutionProfile.ORCHESTRATOR,
    );

    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-esc-orchestrator',
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );

    const request = makeInvocationRequest({
      invocationId: 'inv-esc-orchestrator-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      requestedPath: undefined,
      humanApprovalReference: 'release-ref-valid',
    });

    const result = await harness.service.invoke(request);

    // Der Claim hat den Policy-Kanal nicht erreicht — autoritativ bleibt ORCHESTRATOR.
    expect(harness.executionProfileResolver.resolve).toHaveBeenCalledTimes(1);
    expect(
      latestResolverCall(harness.executionPolicyResolver).executionProfile,
    ).toBe(ExecutionProfile.ORCHESTRATOR);

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
  });

  // =========================================================================
  // Adversarial Case 4 — Human-Gate-Genehmigung konvertiert KEINE
  // unberechtigte Actor-/Profil-Lage in RELEASE_AUTHORITY
  // =========================================================================

  it('human gate approval must not convert an unauthorized actor/profile into RELEASE_AUTHORITY', async () => {
    // WAHRE Runtime-Bindung dieses Step-Runs: BUILDER (nicht release-berechtigt).
    const harness = buildEscalationHarness(ExecutionProfile.BUILDER);

    // Isolation des Angriffsvektors: Das Gate selbst ist ECHT, nicht
    // abgelaufen und kontextuell vollständig gebunden (Org/Run/Step/
    // Capability/Provider/Input). Es fehlt AUSSCHLIESSLICH die Actor-/Profil-
    // Berechtigung — und genau diese darf durch das Genehmigungsobjekt
    // nicht ersetzt werden.
    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-authentic-but-misdirected',
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );

    const request = makeInvocationRequest({
      invocationId: 'inv-esc-gate-conversion-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_PUSH,
      requestedPath: undefined,
      humanApprovalReference: 'release-ref-authentic',
    });

    const result = await harness.service.invoke(request);

    // Das authentische Binding wurde vertrauenswürdig aufgelöst und hätte
    // den Gate auf APPROVED gehoben — Gate-Satisfaction ist dennoch keine
    // Entitlement-Substitution.
    expect(harness.humanGateResolver.resolve).toHaveBeenCalledTimes(1);
    expect(
      latestResolverCall(harness.executionPolicyResolver).executionProfile,
    ).toBe(ExecutionProfile.BUILDER);

    // Sichere Erwartung: Fail closed VOR adapter.execute().
    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(result.status).toBe(AgentExecutionStatus.POLICY_BLOCKED);
    expect(JSON.stringify(result)).not.toContain(ReleaseGateStatus.APPROVED);
  });

  // =========================================================================
  // Positivkontrolle (Case 5) — Genuin berechtigter RELEASE_AUTHORITY-
  // Kontext mit gültigem, passendem Human Gate darf weiterhin ausführen.
  // =========================================================================

  it('a genuinely trusted RELEASE_AUTHORITY context with valid matching human gate may still proceed', async () => {
    // Genuiner Release-Kontext: Die trusted Runtime-Bindung liefert
    // RELEASE_AUTHORITY — Claim und berechtigter Kontext fallen zusammen.
    const harness = buildEscalationHarness(ExecutionProfile.RELEASE_AUTHORITY);

    (harness.humanGateResolver.resolve as jest.Mock).mockResolvedValue(
      makeMatchingHumanGateBinding({
        approvalId: 'approval-legit-release',
        expiresAt: new Date(Date.now() + 600_000),
      }),
    );

    // Der Schritt IST eine Release-Authority-Stufe; Claim und berechtigter
    // Kontext fallen hier zusammen.
    const request = makeInvocationRequest({
      invocationId: 'inv-esc-legit-release-1',
      executionProfile: ExecutionProfile.RELEASE_AUTHORITY,
      requestedAction: ExecutionAction.GIT_COMMIT,
      requestedPath: undefined,
      humanApprovalReference: 'release-ref-valid',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);

    const [, executionContext] = harness.fakeAdapter.execute.mock.calls[0];
    expect(executionContext.policyDecision.allowed).toBe(true);
    expect(executionContext.policyDecision.reasonCode).toBe('POLICY_ALLOWED');
  });
});

// ===========================================================================
// EO-01.5 Phase 3C — Runtime Failure Boundary Tests
//
// Kerninvariante: adapter.execute() wird ausschließlich nach echtem
// EO-01.4 ALLOW erreicht. Runtime-Fehler NACH dieser Grenze (Timeout,
// Adapter-Exception, illegaler Lifecycle-Status) werden normalisiert,
// ohne eine zweite Lifecycle-State-Machine, Retry oder Fallback einzuführen.
//
// Der echte EO-01.4 evaluatePolicy() läuft weiterhin (nicht gemockt).
// ===========================================================================

describe('GovernedInvocationServiceImpl Phase 3C runtime failure boundary', () => {
  function buildRuntimeFailureHarness(execute: jest.Mock): Harness {
    return buildHarness({
      fakeAdapter: {
        adapter: { providerType: ProviderType.CLOUD_LLM, execute } as GovernedProviderAdapter,
        execute,
      },
    });
  }

  function getCompletionAuditEvents(harness: Harness): Array<Record<string, any>> {
    const auditMock = harness.auditService.record as unknown as jest.Mock;
    return auditMock.mock.calls
      .map((call) => call[0])
      .filter((event) => event?.action === 'GOVERNED_INVOCATION_COMPLETE');
  }

  // =========================================================================
  // A. Timeout-Enforcement: EO-01.5 selbst begrenzt einen nicht
  //    zurückkehrenden Adapter — unabhängig davon, ob der Adapter freiwillig
  //    context.timeoutMs honoriert.
  // =========================================================================

  it('adapter timeout is normalized as TIMED_OUT', async () => {
    // Kontrollierter Fake-Adapter: nie auflösend — kein freiwilliges
    // Timeout-Honoring möglich. Nur die EO-01.5-Grenze kann begrenzen.
    const execute = jest.fn(
      (_request: unknown, _context: GovernedExecutionContext): Promise<never> =>
        new Promise(() => {
          // bewusst nie auflösend
        }),
    );
    const harness = buildRuntimeFailureHarness(execute);

    const request = makeInvocationRequest({
      invocationId: 'inv-runtime-timeout-1',
      executionBudget: { maxDurationMs: 25, maxTokens: 100000 },
    });

    const result = await harness.service.invoke(request);

    // EO-01.4 hat zuerst erlaubt; der Adapter wurde genau einmal aufgerufen.
    expect(execute).toHaveBeenCalledTimes(1);
    const [, executionContext] = execute.mock.calls[0];
    expect(executionContext.policyDecision.allowed).toBe(true);
    expect(executionContext.timeoutMs).toBe(25);

    // Die Invocation ist begrenzt terminiert — kein Hang, kein Retry.
    expect(result.durationMs).toBeLessThan(4000);

    expect(result.status).toBe(AgentExecutionStatus.TIMED_OUT);
    expect(result.normalizedError?.reason).toBe('EXECUTION_FAILED');
    expect(result.normalizedError?.executionOutcome).toBe(
      ExecutionOutcome.TIMED_OUT,
    );
    expect(result.normalizedError?.agentExecutionStatus).toBe(
      AgentExecutionStatus.TIMED_OUT,
    );
    expect(result.normalizedError?.retryable).toBe(false);

    // Audit-sichere Completion-Semantik bleibt konsistent.
    const completionEvents = getCompletionAuditEvents(harness);
    expect(completionEvents).toHaveLength(1);
    expect(completionEvents[0]?.metadata?.status).toBe(
      AgentExecutionStatus.TIMED_OUT,
    );
  });

  // =========================================================================
  // B. Adapter-Exception-Normalisierung: Die rohe Exception verlässt
  //    invoke() NICHT als unhandled rejection; es entsteht ein normales,
  //    audit-sicheres FAILED-Ergebnis ohne automatischen Retry/Fallback.
  // =========================================================================

  it('adapter exception is normalized as EXECUTION_FAILED', async () => {
    const RAW_STACK_MARKER = 'RAW-ADAPTER-STACK-MARKER-7f3a';
    const execute = jest.fn().mockImplementation(async () => {
      const error = new Error('controlled adapter failure');
      error.stack = RAW_STACK_MARKER;
      throw error;
    });
    const harness = buildRuntimeFailureHarness(execute);

    const request = makeInvocationRequest({
      invocationId: 'inv-runtime-exception-1',
    });

    const result = await harness.service.invoke(request);

    expect(execute).toHaveBeenCalledTimes(1);

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.normalizedError?.reason).toBe('EXECUTION_FAILED');
    // Sichere Fehlermeldung bleibt erhalten.
    expect(result.normalizedError?.message).toContain(
      'controlled adapter failure',
    );
    expect(result.normalizedError?.retryable).toBe(false);

    // Kein Leak der rohen Exception (Stack, Error-Klasse) durch das Result.
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(RAW_STACK_MARKER);
    expect(serializedResult).not.toContain('AdapterExecutionTimeoutError');

    // Audit-Ausgaben enthalten keine rohen Exception-Materialien.
    const auditMock = harness.auditService.record as unknown as jest.Mock;
    for (const call of auditMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(RAW_STACK_MARKER);
    }

    // Konsistente Completion-Audits, kein automatischer Retry.
    expect(getCompletionAuditEvents(harness)).toHaveLength(1);
  });

  // =========================================================================
  // C. Illegale Lifecycle-Status-Terminalisierung: Ein Adapter darf QUEUED/
  //    STARTING/RUNNING nicht als Abschluss einer produktiven Invocation
  //    zurückgeben. isValidInvocationTransition() ist die bestehende
  //    Enforcement-Mechanik — fail closed auf FAILED.
  // =========================================================================

  it.each([
    AgentExecutionStatus.QUEUED,
    AgentExecutionStatus.STARTING,
    AgentExecutionStatus.RUNNING,
  ])('illegal adapter lifecycle status %s is rejected', async (illegalStatus) => {
    const execute = jest.fn().mockResolvedValue({
      status: illegalStatus,
      providerExecutionMetadata: {},
      completedAt: new Date(),
    });
    const harness = buildRuntimeFailureHarness(execute);

    const request = makeInvocationRequest({
      invocationId: `inv-runtime-illegal-${illegalStatus}`,
    });

    const result = await harness.service.invoke(request);

    // Genau ein produktiver Adapter-Aufruf nach EO-01.4 ALLOW ...
    expect(execute).toHaveBeenCalledTimes(1);
    const [, executionContext] = execute.mock.calls[0];
    expect(executionContext.policyDecision.allowed).toBe(true);

    // ... aber der illegale Status wird NICHT als valides Terminal-Ergebnis
    // normalisiert — fail closed auf bestehendes Vokabular.
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.status).not.toBe(illegalStatus);
    expect(result.normalizedError?.reason).toBe('EXECUTION_FAILED');
    expect(result.normalizedError?.agentExecutionStatus).toBe(
      AgentExecutionStatus.FAILED,
    );
    expect(result.normalizedError?.retryable).toBe(false);
    // Der Lifecycle-Fehler ist im normalisierten Fehler identifizierbar.
    expect(result.normalizedError?.message).toContain(illegalStatus);
    expect(getCompletionAuditEvents(harness)).toHaveLength(1);
  });
});

// ===========================================================================
// EO-01.5 Phase 3D — Provider Eligibility Revalidation Tests
//
// Invariante: Routing-Eligibility ist KEIN permanentes Authorization-Token.
// Der Provider-State kann zwischen EO-01.3 Routing → EO-01.4 Policy →
// EO-01.5 Adapter-Ausführung kippen. Die Invocation-Grenze prüft die
// CURRENT Declaration deterministisch und fail-closed — ohne Re-Routing,
// ohne Ranking-Duplikat, ohne Fallback.
//
// EO-01.3 QUOTA-Semantik (provider-router.service.ts): AVAILABLE/LIMITED
// routbar (LIMITED explizit getestet); EXHAUSTED ineligible; UNKNOWN
// fail-closed (QUOTA_STATUS_UNKNOWN).
// ===========================================================================

describe('GovernedInvocationServiceImpl Phase 3D provider eligibility revalidation', () => {
  it('provider with exhausted quota is rejected before adapter execution', async () => {
    // Stale-Routing-Szenario: Status/Health/Capability bleiben voll routing-
    // tauglich — NUR die Quote ist seit der EO-01.3-Routing-Entscheidung
    // EXHAUSTED geworden.
    const provider = makeProviderDeclaration({
      quotaStatus: ProviderQuotaStatus.EXHAUSTED,
    });
    const harness = buildHarness({ provider });

    expect(provider.status).toBe(ProviderStatus.ACTIVE);
    expect(provider.healthStatus).toBe(ProviderHealthStatus.HEALTHY);
    expect(isProviderRoutable(provider)).toBe(true);

    const request = makeInvocationRequest({
      invocationId: 'inv-quota-exhausted-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'PROVIDER_NOT_ELIGIBLE',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    // Kein Fallback: nur der eine registrierte Adapter existiert und wurde
    // nicht aufgerufen.
    expect(harness.adapterRegistry.getSupportedProviderTypes()).toHaveLength(1);
  });

  it('provider with unknown quota is rejected before adapter execution', async () => {
    const provider = makeProviderDeclaration({
      quotaStatus: ProviderQuotaStatus.UNKNOWN,
    });
    const harness = buildHarness({ provider });

    expect(provider.status).toBe(ProviderStatus.ACTIVE);
    expect(provider.healthStatus).toBe(ProviderHealthStatus.HEALTHY);

    const request = makeInvocationRequest({
      invocationId: 'inv-quota-unknown-1',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'PROVIDER_NOT_ELIGIBLE',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
  });

  it('provider with available quota may proceed', async () => {
    // Positive Kontrolle: vollständige CURRENT-Eligibility → genau ein
    // produktiver Adapter-Aufruf nach echtem EO-01.4 ALLOW.
    const provider = makeProviderDeclaration({
      quotaStatus: ProviderQuotaStatus.AVAILABLE,
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-quota-available-1',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    const [, executionContext] = harness.fakeAdapter.execute.mock.calls[0];
    expect(executionContext.policyDecision.allowed).toBe(true);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });

  it('provider with limited quota remains eligible at the invocation boundary', async () => {
    // LIMITED ist laut EO-01.3 explizit routbar ("LIMITED explizit getestet").
    // Die Invocation-Grenze darf keine strengere Quota-Semantik erfinden.
    const provider = makeProviderDeclaration({
      quotaStatus: ProviderQuotaStatus.LIMITED,
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-quota-limited-1',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });

  it('provider eligibility loss after routing does not become execution authority', async () => {
    // Dieselbe providerId wurde soeben noch erfolgreich gerouted UND
    // produktiv ausgeführt. Danach kippt der Provider-State (Quote →
    // EXHAUSTED). Historische Auswahl/Ausführung ist KEIN Permission-Token:
    // die CURRENT Declaration entscheidet.
    let currentProvider = makeProviderDeclaration();
    const providerResolver: ProviderResolver = {
      resolve: jest.fn(async () => currentProvider),
    };
    const harness = buildHarness({ providerResolver });

    const firstResult = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-stale-route-1' }),
    );
    expect(firstResult.status).toBe(AgentExecutionStatus.SUCCEEDED);
    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);

    // State-Flip NACH erfolgreichem Routing/Execution desselben Providers.
    currentProvider = makeProviderDeclaration({
      id: currentProvider.id,
      quotaStatus: ProviderQuotaStatus.EXHAUSTED,
    });

    await expect(
      harness.service.invoke(
        makeInvocationRequest({ invocationId: 'inv-stale-route-2' }),
      ),
    ).rejects.toThrow('PROVIDER_NOT_ELIGIBLE');

    // Kein zweiter produktiver Aufruf, kein Fallback.
    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(harness.adapterRegistry.getSupportedProviderTypes()).toHaveLength(1);
  });
});

// ===========================================================================
// EO-01.5 Phase 3E — Assurance + Budget Revalidation Tests
//
// Invariante: Auch Assurance-Kompatibilität und Budget-/Kosten-Eligibility
// sind KEINE permanenten Authorization-Token aus dem Routing. Die CURRENT
// Declaration muss beide Dimensionen unmittelbar vor adapter.execute()
// weiterhin erfüllen — deterministisch, ohne Re-Routing, Ranking oder
// Fallback.
//
// Bewahrte EO-01.3-Semantik:
// - Assurance (providerSupportsAssuranceLevel): leere assuranceLevels =>
//   kompatibel (v0.1 Registration fail-open); sonst explizite Mitgliedschaft.
// - Budget: kein maxCostMinorUnits => Check blockiert nicht;
//   unbekannte Kosten + gesetztes Budget => fail-closed;
//   estimated > max => reject; estimated <= max => eligible;
//   costScore ist NIEMALS monetäre Budget-Authorität.
// ===========================================================================

describe('GovernedInvocationServiceImpl Phase 3E assurance and budget revalidation', () => {
  // =========================================================================
  // A. Assurance Revalidation
  // =========================================================================

  it('provider without requested assurance level is rejected before adapter execution', async () => {
    // Sonst voll eligibility-geeigneter Provider; AL5 ist nicht deklariert.
    const provider = makeProviderDeclaration({
      assuranceLevels: ['AL1', 'AL2', 'AL3', 'AL4'],
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-assurance-unsupported-1',
      assuranceLevel: 'AL5',
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'PROVIDER_NOT_ELIGIBLE',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    expect(harness.adapterRegistry.getSupportedProviderTypes()).toHaveLength(1);
  });

  it('provider supporting requested assurance level may proceed', async () => {
    const provider = makeProviderDeclaration();
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-assurance-supported-1',
      assuranceLevel: 'AL2',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    const [, executionContext] = harness.fakeAdapter.execute.mock.calls[0];
    expect(executionContext.policyDecision.allowed).toBe(true);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });

  it('empty provider assurance levels remain compatible with requested level', async () => {
    // EO-01.3-Semantik bewahren: leere assuranceLevels => kompatibel
    // (v0.1 Registration fail-open). Keine strengere EO-01.5-Regel erfinden.
    const provider = makeProviderDeclaration({ assuranceLevels: [] });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-assurance-empty-levels-1',
      assuranceLevel: 'AL9',
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });

  // =========================================================================
  // B. Budget / Cost Revalidation
  // =========================================================================

  it('provider exceeding execution budget is rejected before adapter execution', async () => {
    const provider = makeProviderDeclaration({
      estimatedCostMinorUnits: 5000,
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-budget-exceeded-1',
      executionBudget: { maxDurationMs: 60000, maxCostMinorUnits: 1000 },
    });

    await expect(harness.service.invoke(request)).rejects.toThrow(
      'PROVIDER_NOT_ELIGIBLE',
    );

    expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
  });

  it.each([null, undefined])(
    'provider with unknown estimated cost (%s) is rejected when execution budget is bounded',
    async (unknownCost) => {
      const provider = makeProviderDeclaration({
        estimatedCostMinorUnits: unknownCost,
      });
      const harness = buildHarness({ provider });

      const request = makeInvocationRequest({
        invocationId: `inv-budget-cost-unknown-${String(unknownCost)}-1`,
        executionBudget: { maxDurationMs: 60000, maxCostMinorUnits: 1000 },
      });

      await expect(harness.service.invoke(request)).rejects.toThrow(
        'PROVIDER_NOT_ELIGIBLE',
      );

      expect(harness.fakeAdapter.execute).not.toHaveBeenCalled();
    },
  );

  it('provider within execution budget may proceed', async () => {
    const provider = makeProviderDeclaration({
      estimatedCostMinorUnits: 500,
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-budget-within-1',
      executionBudget: { maxDurationMs: 60000, maxCostMinorUnits: 1000 },
    });

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });

  it('absence of maxCostMinorUnits does not block solely because provider cost is unknown', async () => {
    // EO-01.3-Semantik bewahren: Ohne monetäres Maximalbudget blockiert der
    // Budget-Check nicht — unbekannte Kosten allein reichen nicht.
    const provider = makeProviderDeclaration({
      estimatedCostMinorUnits: null,
    });
    const harness = buildHarness({ provider });

    const request = makeInvocationRequest({
      invocationId: 'inv-budget-unbounded-unknown-cost-1',
      executionBudget: { maxDurationMs: 60000, maxTokens: 100000 },
    });
    expect(request.executionBudget.maxCostMinorUnits).toBeUndefined();

    const result = await harness.service.invoke(request);

    expect(harness.fakeAdapter.execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
  });
});

// ===========================================================================
// EO-01.5 Phase 3F — Output + Error Leakage Boundary Tests
//
// Invariante: Credential-/Geheimmaterial darf innerhalb der vertrauens-
// würdigen Adapter-Grenze existieren, aber NIEMALS durch normalisierte
// Invocation-Outputs oder audit-sichere Metadaten entweichen — unabhängig
// davon, ob der Adapter freiwillig saubere Strings liefert.
//
// Adversariales Modell: Der Fake-Adapter erhält die ECHTE credentialReference
// am Boundary und leakt sie gezielt auf jeder Output-Fläche. Zusätzlich
// werden bekannte Geheim-Materialformen (Bearer/JWT/Token-Präfixe) getestet.
//
// Bewusste Grenzen (v0.1): Kein DLP-System — deterministische, begrenzte
// Regeln: exakte Redaction vertrauenswürdiger Werte, explizite Geheimformen,
// Schema-Validierung regierter Referenzen, Längenbegrenzung.
// ===========================================================================

describe('GovernedInvocationServiceImpl Phase 3F output and error leakage boundary', () => {
  const SECRET_MARKER = 'SECRET_REF_DO_NOT_LEAK_7f3a';

  function buildLeakageHarness(execute: jest.Mock): Harness {
    // REQUIRED-Credential-Pfad: Die trusted Broker-Reference IST der Marker
    // und erreicht den Adapter-Boundary als context.credentialReference.
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const broker: CredentialBroker = {
      getCredentialReference: jest.fn().mockResolvedValue(SECRET_MARKER),
      validateCredentialReference: jest.fn().mockResolvedValue(true),
    };
    return buildHarness({
      provider,
      credentialBroker: broker,
      fakeAdapter: {
        adapter: { providerType: ProviderType.CLOUD_LLM, execute } as GovernedProviderAdapter,
        execute,
      },
    });
  }

  function assertMarkerContainedNowhere(harness: Harness, result: GovernedCapabilityInvocationResult): void {
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).not.toContain(SECRET_MARKER);

    const auditMock = harness.auditService.record as unknown as jest.Mock;
    for (const call of auditMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_MARKER);
    }
  }

  function leakyExecute(
    resultOverride: Partial<GovernedAdapterResult>,
  ): jest.Mock {
    return jest.fn(
      async (_request: unknown, context: GovernedExecutionContext): Promise<GovernedAdapterResult> => {
        // Der Marker MUSS am Adapter-Boundary sichtbar gewesen sein — sonst
        // testet die Assertion nichts.
        expect(context.credentialReference).toBe(SECRET_MARKER);
        return {
          status: AgentExecutionStatus.SUCCEEDED,
          providerExecutionMetadata: {},
          completedAt: new Date(),
          ...resultOverride,
        };
      },
    );
  }

  // =========================================================================
  // B. Output References
  // =========================================================================

  it('secret material in outputReference is not leaked', async () => {
    const execute = leakyExecute({ outputReference: SECRET_MARKER });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-output-ref-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
    // Verworfene/geheime Referenz darf nicht durchgereicht werden.
    expect(result.outputReference).toBeUndefined();
    assertMarkerContainedNowhere(harness, result);
  });

  it('secret material in artifactReferences is not leaked', async () => {
    const execute = leakyExecute({
      artifactReferences: ['gov://artifacts/clean-artifact', SECRET_MARKER],
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-artifact-ref-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
    // Saubere Referenz bleibt erhalten; geheime Referenz wird verworfen.
    expect(result.artifactReferences).toEqual(['gov://artifacts/clean-artifact']);
    expect(result.sideEffectSummary?.artifactsCreated).toEqual([
      'gov://artifacts/clean-artifact',
    ]);
    assertMarkerContainedNowhere(harness, result);
  });

  it('secret material in evidenceReferences is not leaked', async () => {
    const execute = leakyExecute({
      evidenceReferences: ['gov://evidence/clean-evidence', SECRET_MARKER],
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-evidence-ref-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.evidenceReferences).toEqual(['gov://evidence/clean-evidence']);
    assertMarkerContainedNowhere(harness, result);
  });

  // =========================================================================
  // C. Error Surface
  // =========================================================================

  it('secret material in returned adapter error message is not leaked', async () => {
    const execute = leakyExecute({
      status: AgentExecutionStatus.FAILED,
      error: {
        code: 'PROVIDER_UPSTREAM_ERROR',
        message: `upstream provider failed with reference ${SECRET_MARKER} during completion`,
        retryable: false,
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-error-msg-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.normalizedError?.reason).toBe('EXECUTION_FAILED');
    // Diagnose bleibt nützlich, das Geheimmaterial nicht.
    expect(result.normalizedError?.message).toContain('upstream provider failed');
    expect(result.normalizedError?.message).not.toContain(SECRET_MARKER);
    assertMarkerContainedNowhere(harness, result);
  });

  it('secret material in thrown adapter error is not leaked', async () => {
    const execute = jest.fn(
      async (_request: unknown, context: GovernedExecutionContext): Promise<GovernedAdapterResult> => {
        expect(context.credentialReference).toBe(SECRET_MARKER);
        throw new Error(`adapter exploded while using reference ${SECRET_MARKER}`);
      },
    );
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-thrown-error-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.normalizedError?.reason).toBe('EXECUTION_FAILED');
    expect(result.normalizedError?.message).toContain('adapter exploded');
    expect(result.normalizedError?.message).not.toContain(SECRET_MARKER);
    assertMarkerContainedNowhere(harness, result);
  });

  // =========================================================================
  // D. Provider Metadata / Side Effects
  // =========================================================================

  it('secret material in provider execution metadata is sanitized', async () => {
    const execute = leakyExecute({
      providerExecutionMetadata: {
        credentialReference: SECRET_MARKER,
        token: SECRET_MARKER,
        nested: { apiKey: SECRET_MARKER },
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-metadata-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);
    assertMarkerContainedNowhere(harness, result);
  });

  it('secret material in side effect fields does not reach audit output', async () => {
    const execute = leakyExecute({
      providerExecutionMetadata: {
        sideEffects: {
          filesCreated: [`/tmp/session/${SECRET_MARKER}.json`],
          filesModified: [`/workspace/report-${SECRET_MARKER}.md`],
          filesDeleted: [],
          commandsExecuted: [`echo ${SECRET_MARKER}`],
          networkCalls: [
            {
              destination: `https://api.example.com/callback?ref=${SECRET_MARKER}`,
              method: 'GET',
              timestamp: new Date(),
            },
          ],
        },
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-side-effects-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.SUCCEEDED);

    const summary = result.sideEffectSummary!;
    expect(summary.filesCreated[0]).toContain('/tmp/session/');
    expect(summary.filesCreated[0]).toContain('[REDACTED]');
    expect(summary.filesModified[0]).toContain('[REDACTED]');
    expect(summary.commandsExecuted[0]).toContain('[REDACTED]');
    expect(summary.networkCalls?.[0]?.destination).toContain('[REDACTED]');

    expect(summary.filesCreated.join(' ')).not.toContain(SECRET_MARKER);
    expect(summary.filesModified.join(' ')).not.toContain(SECRET_MARKER);
    expect(summary.commandsExecuted.join(' ')).not.toContain(SECRET_MARKER);
    expect((summary.networkCalls ?? []).map((n) => n.destination).join(' ')).not.toContain(SECRET_MARKER);

    assertMarkerContainedNowhere(harness, result);
  });

  it('known secret shapes are redacted from free-form error text without exact-value knowledge', async () => {
    // Generische Formen (unabhängig vom konkreten Marker) müssen ebenfalls
    // nicht entweichen — z. B. ein Bearer-Token im Fehlertext des Adapters.
    const TOKEN = `Bearer ${'c'.repeat(44)}`;
    const execute = jest.fn(
      async (): Promise<GovernedAdapterResult> => {
        throw new Error(`provider rejected credentials ${TOKEN}`);
      },
    );
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-token-shape-1' }),
    );

    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.normalizedError?.message).toContain('provider rejected credentials [REDACTED]');
    expect(result.normalizedError?.message).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

// ===========================================================================
// EO-01.5 Phase 3F.1 — Exact Trusted Secret Value Redaction in Metadata
//
// Finding aus unabhängigem Review: sanitizeProviderExecutionMetadata()
// filtert primär über sensible Schlüsselnamen und generische Geheimformen.
// Ein vertrauenswürdiger Wert (die credentialReference dieser Invocation)
// kann daher unter unschuldigem Feldnamen entweichen.
//
// Korrektur: exakte Wert-Redaction der credentialReference auf ALLEN
// Metadaten-Flächen (providerExecutionMetadata, usageMetadata, normalized
// error provider metadata) — rekursiv, unabhängig von Verschachtelungstiefe
// oder Feldnamen.
// ===========================================================================

describe('GovernedInvocationServiceImpl Phase 3F.1 exact trusted secret value redaction', () => {
  const SECRET_MARKER = 'SECRET_REF_DO_NOT_LEAK_7f3a';

  function buildLeakageHarness(execute: jest.Mock): Harness {
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const broker: CredentialBroker = {
      getCredentialReference: jest.fn().mockResolvedValue(SECRET_MARKER),
      validateCredentialReference: jest.fn().mockResolvedValue(true),
    };
    return buildHarness({
      provider,
      credentialBroker: broker,
      fakeAdapter: {
        adapter: { providerType: ProviderType.CLOUD_LLM, execute } as GovernedProviderAdapter,
        execute,
      },
    });
  }

  function boundaryExecute(
    resultOverride: Partial<GovernedAdapterResult>,
  ): jest.Mock {
    return jest.fn(
      async (_request: unknown, context: GovernedExecutionContext): Promise<GovernedAdapterResult> => {
        expect(context.credentialReference).toBe(SECRET_MARKER);
        return {
          status: AgentExecutionStatus.SUCCEEDED,
          providerExecutionMetadata: {},
          completedAt: new Date(),
          ...resultOverride,
        };
      },
    );
  }

  function assertMarkerContainedNowhere(harness: Harness, result: GovernedCapabilityInvocationResult): void {
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    const auditMock = harness.auditService.record as unknown as jest.Mock;
    for (const call of auditMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_MARKER);
    }
  }

  it('exact credential reference in provider metadata is redacted regardless of field name', async () => {
    // Bewusst unsensibler Feldname: der Schutz muss vom WERT kommen,
    // nicht vom Schlüsselnamen-Filter.
    const execute = boundaryExecute({
      providerExecutionMetadata: {
        harmlessFieldName: SECRET_MARKER,
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-meta-innocent-key-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.providerExecutionMetadata ?? {})).not.toContain(SECRET_MARKER);
    assertMarkerContainedNowhere(harness, result);
  });

  it('exact credential reference in usage metadata is redacted regardless of field name', async () => {
    const execute = boundaryExecute({
      usageMetadata: {
        innocentDescription: SECRET_MARKER,
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-usage-innocent-key-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.usageMetadata).toBeDefined();
    expect(JSON.stringify(result.usageMetadata ?? {})).not.toContain(SECRET_MARKER);
    assertMarkerContainedNowhere(harness, result);
  });

  it('exact credential reference nested in metadata arrays and objects is redacted', async () => {
    // Verschachtelte Strukturen dürfen die exakte Wert-Redaction nicht
    // umgehen können.
    const execute = boundaryExecute({
      providerExecutionMetadata: {
        outer: {
          innerList: [{ deepField: SECRET_MARKER }, 'clean-entry'],
          plain: SECRET_MARKER,
        },
        list: [SECRET_MARKER, 'also-clean'],
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-meta-nested-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.providerExecutionMetadata ?? {})).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(result.providerExecutionMetadata ?? {})).toContain('clean-entry');
    expect(JSON.stringify(result.providerExecutionMetadata ?? {})).toContain('also-clean');
    assertMarkerContainedNowhere(harness, result);
  });

  it('exact credential reference in adapter error provider metadata is redacted', async () => {
    const execute = boundaryExecute({
      status: AgentExecutionStatus.FAILED,
      error: {
        code: 'PROVIDER_UPSTREAM_ERROR',
        message: 'upstream failed',
        retryable: false,
        providerMetadata: {
          contextHint: SECRET_MARKER,
        },
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-error-meta-innocent-key-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(AgentExecutionStatus.FAILED);
    expect(result.normalizedError?.providerMetadata).toBeDefined();
    expect(JSON.stringify(result.normalizedError?.providerMetadata ?? {})).not.toContain(SECRET_MARKER);
    assertMarkerContainedNowhere(harness, result);
  });
});

// ===========================================================================
// EO-01.5 Phase 3F.2 — Trusted Secret Redaction in Metadata KEYS
//
// Finding aus unabhängigem Review: 3F.1 redactiert Werte rekursiv, erhält
// aber Objekt-Schlüssel unverändert. Ein bösartiger Adapter kann die
// credentialReference als JSON-Property-Name entweichen lassen.
//
// Kerninvariante: Die exakte vertrauenswürdige credentialReference darf
// NERGENDWO im normalisierten Ergebnis oder Audit-Output erscheinen —
// weder als Wert noch als Objekt-Schlüssel.
// ===========================================================================

describe('GovernedInvocationServiceImpl Phase 3F.2 trusted secret redaction in metadata keys', () => {
  // Bewusst OHNE sensible Schlüsselnamen-Substrings (kein "secret"/"token"/
  // "credential"): der Schutz muss über die exakte WERT-Gleichheit wirken,
  // nicht über zufälliges Ansprechen des Schlüsselnamen-Filters des
  // Contracts-Sanitizers.
  const SECRET_MARKER = 'REF_DO_NOT_LEAK_7f3a9c4e';

  function buildLeakageHarness(execute: jest.Mock): Harness {
    const provider = makeProviderDeclaration({
      credentialRequirement: ProviderCredentialRequirement.REQUIRED,
    });
    const broker: CredentialBroker = {
      getCredentialReference: jest.fn().mockResolvedValue(SECRET_MARKER),
      validateCredentialReference: jest.fn().mockResolvedValue(true),
    };
    return buildHarness({
      provider,
      credentialBroker: broker,
      fakeAdapter: {
        adapter: { providerType: ProviderType.CLOUD_LLM, execute } as GovernedProviderAdapter,
        execute,
      },
    });
  }

  function boundaryExecute(
    resultOverride: Partial<GovernedAdapterResult>,
  ): jest.Mock {
    return jest.fn(
      async (_request: unknown, context: GovernedExecutionContext): Promise<GovernedAdapterResult> => {
        expect(context.credentialReference).toBe(SECRET_MARKER);
        return {
          status: AgentExecutionStatus.SUCCEEDED,
          providerExecutionMetadata: {},
          completedAt: new Date(),
          ...resultOverride,
        };
      },
    );
  }

  function assertMarkerContainedNowhere(harness: Harness, result: GovernedCapabilityInvocationResult): void {
    expect(JSON.stringify(result)).not.toContain(SECRET_MARKER);
    const auditMock = harness.auditService.record as unknown as jest.Mock;
    for (const call of auditMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_MARKER);
    }
  }

  it('exact credential reference used as metadata key is redacted', async () => {
    const execute = boundaryExecute({
      providerExecutionMetadata: {
        [SECRET_MARKER]: 'harmless',
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-meta-key-top-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    // Der Inhalt unter dem redactierten Schlüssel bleibt erhalten —
    // Redaction des Schlüssels, keine Vernichtung des Objekts.
    const serializedMetadata = JSON.stringify(result.providerExecutionMetadata ?? {});
    expect(serializedMetadata).toContain('[REDACTED]');
    expect(serializedMetadata).toContain('harmless');
    assertMarkerContainedNowhere(harness, result);
  });

  it('exact credential reference used as nested metadata key is redacted', async () => {
    const execute = boundaryExecute({
      providerExecutionMetadata: {
        outer: {
          [SECRET_MARKER]: 'harmless',
        },
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-meta-key-nested-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const serializedMetadata = JSON.stringify(result.providerExecutionMetadata ?? {});
    expect(serializedMetadata).toContain('[REDACTED]');
    expect(serializedMetadata).toContain('outer');
    expect(serializedMetadata).toContain('harmless');
    assertMarkerContainedNowhere(harness, result);
  });

  it('exact credential reference used as usage metadata key is redacted', async () => {
    const execute = boundaryExecute({
      usageMetadata: {
        [SECRET_MARKER]: 'usage-value',
        plainKey: 'plain-value',
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-usage-key-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const serializedUsage = JSON.stringify(result.usageMetadata ?? {});
    expect(serializedUsage).toContain('[REDACTED]');
    expect(serializedUsage).toContain('usage-value');
    expect(serializedUsage).toContain('plainKey');
    assertMarkerContainedNowhere(harness, result);
  });

  it('metadata key collision after key redaction does not overwrite existing entry', async () => {
    // Zwei Einträge, deren Schlüssel nach der Redaction kollidieren:
    // der erste gewinnt deterministisch; kein attacker-kontrolliertes
    // Überschreiben eines sicherheitsrelevanten Feldes.
    const execute = boundaryExecute({
      providerExecutionMetadata: {
        [SECRET_MARKER]: 'first-entry',
        '[REDACTED]': 'second-entry',
      },
    });
    const harness = buildLeakageHarness(execute);

    const result = await harness.service.invoke(
      makeInvocationRequest({ invocationId: 'inv-leak-meta-key-collision-1' }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const serializedMetadata = JSON.stringify(result.providerExecutionMetadata ?? {});
    expect(serializedMetadata).toContain('first-entry');
    expect(serializedMetadata).not.toContain('second-entry');
    assertMarkerContainedNowhere(harness, result);
  });
});
