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
