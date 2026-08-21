/**
 * Provider Router Contracts für den Engineering Runtime (EO-01.3).
 *
 * Capability != Provider.
 * VITO wählt Provider. n8n darf keine Provider-Selektionslogik enthalten.
 *
 * Reihenfolge der Eligibility-Prüfung:
 *   1. Capability eligibility (enabled ProviderCapability-Assignments)
 *   2. Provider enabled/status policy
 *   3. Availability / quota (inkl. interner QUOTA-Phase)
 *   4. Assurance compatibility
 *   5. Independence requirement
 *   6. Budget eligibility (estimatedCostMinorUnits, fail-closed COST_UNKNOWN)
 *   7. Deterministic score/rank among remaining candidates
 *
 * Ein ineligibler Provider darf NIEMALS wegen eines hohen Scores gewinnen.
 */

import type { ProviderDeclaration } from './provider-registry.js';
import type { IndependenceContext } from './execution.js';

// ---------------------------------------------------------------------------
// Reason Codes
// ---------------------------------------------------------------------------

/** Maschinenlesbare Ablehnungsgrunde für Provider-Routing */
export type RoutingRejectionReason =
  | 'CAPABILITY_UNSUPPORTED'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_UNHEALTHY'
  | 'PROVIDER_UNAVAILABLE'
  | 'QUOTA_UNAVAILABLE'
  | 'QUOTA_EXHAUSTED'
  | 'QUOTA_STATUS_UNKNOWN'
  | 'POLICY_INCOMPATIBLE'
  | 'ASSURANCE_LEVEL_UNSUPPORTED'
  | 'INDEPENDENCE_REQUIREMENT_UNSATISFIED'
  | 'MODEL_IDENTITY_UNVERIFIABLE'
  | 'BUDGET_INCOMPATIBLE'
  | 'COST_UNKNOWN'
  | 'NO_ELIGIBLE_PROVIDER';

/** Mapping von Reason Code zu menschenlesbarem Text */
export const ROUTING_REJECTION_MESSAGES: Record<RoutingRejectionReason, string> = {
  CAPABILITY_UNSUPPORTED: 'Provider unterstützt die angeforderte Capability nicht',
  PROVIDER_DISABLED: 'Provider ist administrativ deaktiviert',
  PROVIDER_UNHEALTHY: 'Provider-Health-Status ist nicht routbar',
  PROVIDER_UNAVAILABLE: 'Provider ist aktuell nicht verfügbar',
  QUOTA_UNAVAILABLE: 'Provider-Quota-Status ist nicht verfügbar',
  QUOTA_EXHAUSTED: 'Provider-Quota ist aufgebraucht',
  QUOTA_STATUS_UNKNOWN: 'Provider-Quota-Status ist unbekannt (fail-closed)',
  POLICY_INCOMPATIBLE: 'Provider ist mit der Ausführungsrichtlinie inkompatibel',
  ASSURANCE_LEVEL_UNSUPPORTED: 'Provider unterstützt das angeforderte Assurance Level nicht',
  INDEPENDENCE_REQUIREMENT_UNSATISFIED: 'Provider erfüllt die Unabhängigkeitsanforderung nicht',
  MODEL_IDENTITY_UNVERIFIABLE: 'Provider-Modellidentität kann nicht verifiziert werden',
  BUDGET_INCOMPATIBLE: 'Provider überschreitet das angegebene Budget',
  COST_UNKNOWN:
    'Geschätzte Kosten sind unbekannt, ein Maximalbudget ist aber gesetzt (fail-closed)',
  NO_ELIGIBLE_PROVIDER: 'Kein geeigneter Provider für die angeforderte Capability',
};

// ---------------------------------------------------------------------------
// Routing Phases
// ---------------------------------------------------------------------------

/** Eligibility-Phasen in der Reihenfolge der Prüfung */
export enum EligibilityPhase {
  CAPABILITY = 'CAPABILITY',
  STATUS_POLICY = 'STATUS_POLICY',
  AVAILABILITY = 'AVAILABILITY',
  QUOTA = 'QUOTA',
  ASSURANCE = 'ASSURANCE',
  INDEPENDENCE = 'INDEPENDENCE',
  BUDGET = 'BUDGET',
}

// ---------------------------------------------------------------------------
// Routing Request / Response
// ---------------------------------------------------------------------------

/** Anfrage an den Provider Router */
export interface ProviderRoutingRequest {
  readonly organizationId: string;
  readonly capability: string;
  readonly assuranceLevel?: string;
  readonly workflowRunId?: string;
  readonly workflowStepRunId?: string;
  readonly independenceContext?: IndependenceContext;
  readonly budget?: {
    readonly maxCostMinorUnits?: number;
    readonly currency?: string;
  };
  readonly correlationId: string;
}

/** Ergebnis einer Routing-Entscheidung */
export interface ProviderRoutingResponse {
  readonly selectedProvider: ProviderDeclaration | null;
  readonly routingDecisionId: string;
  readonly eligibleCandidateIds: readonly string[];
  readonly allCandidateIds: readonly string[];
  readonly rejectionReasons: Record<string, RoutingRejectionReason>;
  readonly rejectionPhases: Record<string, EligibilityPhase>;
  readonly scoreComponents: Record<string, ProviderScoreComponents>;
  readonly finalScores: Record<string, number>;
  readonly decisionReason: string;
}

/** Score-Komponenten für einen Provider */
export interface ProviderScoreComponents {
  readonly qualityScore: number;
  readonly costScore: number;
  readonly latencyScore: number;
  readonly healthPreference: number;
  readonly raw: Record<string, number>;
}

/** Interner Kandidat mit Eligibility-Status */
export interface RoutingCandidate {
  readonly provider: ProviderDeclaration;
  readonly eligible: boolean;
  readonly rejectionReason?: RoutingRejectionReason;
  readonly rejectionPhase?: EligibilityPhase;
  readonly scoreComponents?: ProviderScoreComponents;
  readonly finalScore?: number;
}

// ---------------------------------------------------------------------------
// Routing Decision (persistiert)
// ---------------------------------------------------------------------------

/** Persistierte Routing-Entscheidung */
export interface ProviderRoutingDecisionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly correlationId: string;
  readonly workflowRunId?: string;
  readonly workflowStepRunId?: string;
  readonly requestedCapability: string;
  readonly assuranceLevel?: string;
  readonly selectedProviderId?: string;
  readonly candidateProviderIds: readonly string[];
  readonly rejectionReasons: Record<string, RoutingRejectionReason>;
  readonly scoreComponents: Record<string, ProviderScoreComponents>;
  readonly finalScore?: number;
  readonly decisionReason: string;
  readonly routingPolicyVersion?: string;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Routing Configuration
// ---------------------------------------------------------------------------

/** Score-Gewichtungen für v0.1 Deterministic Routing */
export interface RoutingScoreWeights {
  readonly quality: number;
  readonly cost: number;
  readonly latency: number;
  readonly healthPreference: number;
}

/** Default-Gewichtungen */
export const DEFAULT_ROUTING_SCORE_WEIGHTS: RoutingScoreWeights = {
  quality: 0.4,
  cost: 0.3,
  latency: 0.2,
  healthPreference: 0.1,
} as const;

/** Routing-Policy Version */
export const ROUTING_POLICY_VERSION = 'v0.1' as const;
