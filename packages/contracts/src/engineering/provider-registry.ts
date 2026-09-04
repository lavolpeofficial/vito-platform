/**
 * Provider Registry Contracts für den Engineering Runtime (EO-01.3).
 *
 * Provider Status und Health sind separate Zustandsdimensionen.
 * Provider Status ist admin-gesteuert (ACTIVE/DISABLED/DEGRADED).
 * Provider Health ist system-beobachtet (UNKNOWN/HEALTHY/DEGRADED/QUOTA_LIMITED/UNAVAILABLE/DISABLED).
 *
 * Capability-Zuweisungen sind durable ProviderCapability-Assignments
 * (persistiert, organization-scoped, enable/disable-fähig).
 * Das legacy JSON-Feld `supportedCapabilities` ist NICHT mehr die
 * Routing-Authorität und dient nur noch der Abwärtskompatibilität/Dokumentation.
 */

import type { EngineeringCapability } from './capabilities.js';
import type { AssuranceLevel } from './assurance.js';

/** Admin-gesteuerter Provider-Status */
export enum ProviderStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
  DEGRADED = 'DEGRADED',
}

/** System-beobachteter Health-Status */
export enum ProviderHealthStatus {
  UNKNOWN = 'UNKNOWN',
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  QUOTA_LIMITED = 'QUOTA_LIMITED',
  UNAVAILABLE = 'UNAVAILABLE',
  DISABLED = 'DISABLED',
}

/** Quota-/Kapazitätsstatus */
export enum ProviderQuotaStatus {
  UNKNOWN = 'UNKNOWN',
  AVAILABLE = 'AVAILABLE',
  LIMITED = 'LIMITED',
  EXHAUSTED = 'EXHAUSTED',
}

/** Provider-Klasse */
export enum ProviderType {
  CLOUD_LLM = 'CLOUD_LLM',
  LOCAL_LLM = 'LOCAL_LLM',
  DETERMINISTIC_TOOL = 'DETERMINISTIC_TOOL',
  LOCAL_TOOL = 'LOCAL_TOOL',
}

/**
 * Credential requirement state for a provider.
 * UNKNOWN must fail closed for productive invocation.
 * Do not infer from display names or silently map missing data to NOT_REQUIRED.
 */
export enum ProviderCredentialRequirement {
  REQUIRED = 'REQUIRED',
  NOT_REQUIRED = 'NOT_REQUIRED',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Durable Capability-Zuweisung eines Providers (Spiegelbild des
 * ProviderCapability-Datenmodells). Nur ENABLED Assignments machen einen
 * Provider für eine Capability routing-berechtigt.
 */
export interface ProviderCapabilityAssignment {
  readonly capabilityCode: string;
  readonly isEnabled: boolean;
}

/**
 * Provider-Declaration: eine Provider-Instanz die Engineering Capabilities
 * unterstützt. Provider-Namen (Claude, OpenCode, etc.) sind KEIN Teil
 * der Capability-Codes.
 */
export interface ProviderDeclaration {
  readonly id: string;
  readonly organizationId: string;
  readonly providerCode: string;
  readonly displayName: string;
  readonly providerType: ProviderType;
  readonly status: ProviderStatus;
  readonly modelFamily?: string;
  readonly modelName?: string;
  readonly modelCode?: string;
  /**
   * @deprecated Legacy JSON-Mechanik. NICHT für Routing-Eligibility verwenden.
   * Routing-Authorität sind die enabled ProviderCapability-Assignments
   * (`capabilityAssignments`).
   */
  readonly supportedCapabilities: readonly string[];
  /** Durable, persistierte Capability-Zuweisungen (Routing-Authorität). */
  readonly capabilityAssignments: readonly ProviderCapabilityAssignment[];
  /** Explizite geschätzte Geldkosten in Minor Units (z.B. Cent). NULL = unbekannt. */
  readonly estimatedCostMinorUnits?: number | null;
  readonly healthStatus: ProviderHealthStatus;
  readonly healthCheckedAt?: Date;
  readonly quotaStatus: ProviderQuotaStatus;
  readonly quotaCheckedAt?: Date;
  readonly qualityScore?: number;
  readonly latencyScore?: number;
  /** Reines Ranking-Score (0-1000, niedriger = besser). KEIN Budget-Maßstab. */
  readonly costScore?: number;
  readonly costMetadata: Record<string, unknown>;
  readonly assuranceLevels: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Credential requirement for this provider. UNKNOWN fails closed. */
  readonly credentialRequirement: ProviderCredentialRequirement;
}

/**
 * Deterministische Prüfung ob ein Provider eine Capability unterstützt.
 * Autoritativ sind ausschließlich ENABLED ProviderCapability-Assignments.
 * Das legacy `supportedCapabilities` JSON wird hier bewusst ignoriert.
 */
export function providerSupportsCapability(
  provider: ProviderDeclaration,
  capability: string,
): boolean {
  return provider.capabilityAssignments.some(
    (assignment) => assignment.capabilityCode === capability && assignment.isEnabled,
  );
}

/**
 * Deterministische Prüfung ob ein Provider einen Assurance Level unterstützt.
 * Wenn keine assuranceLevels deklariert sind, unterstützt der Provider ALLE Level
 * (fail-open für v0.1 Registration, nicht für Routing).
 */
export function providerSupportsAssuranceLevel(
  provider: ProviderDeclaration,
  level: string,
): boolean {
  if (provider.assuranceLevels.length === 0) return true;
  return provider.assuranceLevels.includes(level);
}

/**
 * Prüft ob ein Provider für Routing in Frage kommt (Admin-Status + Health).
 * Die detailliertere Eligibility-Prüfung passiert im Router.
 *
 * v0.1 Status-Policy:
 *  - ACTIVE: routbar
 *  - DISABLED: ineligible
 *  - DEGRADED: ineligible (Status-Policy-Phase)
 * Health-Policy:
 *  - HEALTHY: routbar
 *  - DEGRADED: routbar mit Score-Penalty
 *  - UNKNOWN/UNAVAILABLE/DISABLED/QUOTA_LIMITED: ineligible
 */
export function isProviderRoutable(provider: ProviderDeclaration): boolean {
  if (provider.status !== ProviderStatus.ACTIVE) return false;
  if (
    provider.healthStatus !== ProviderHealthStatus.HEALTHY &&
    provider.healthStatus !== ProviderHealthStatus.DEGRADED
  ) {
    return false;
  }
  return true;
}
