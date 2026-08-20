# VITO-EO-01 — Canonical EngineeringTask Contract v0.1

Status: Prepared architecture specification

## Goal

Provide one provider-neutral ingress contract for engineering work submitted by AOE, a human operator or another governed VITO workflow.

## Minimal contract

```ts
interface EngineeringTask {
  id: string;
  organizationId: string;
  sourceType: 'AOE' | 'HUMAN' | 'VITO' | 'SYSTEM';
  sourceRef?: string;
  repository: {
    repositoryFullName?: string;
    localPath?: string;
    targetRef: string;
  };
  title: string;
  requestedOutcome: string;
  scope: {
    allowedPaths?: string[];
    deniedPaths?: string[];
  };
  acceptanceCriteria: string[];
  assuranceLevel: 'AL1' | 'AL2' | 'AL3' | 'AL4';
  constraints: string[];
  executionBudget?: {
    maxDurationMs?: number;
    maxTokens?: number;
    maxCostMinorUnits?: number;
    currency?: string;
  };
  releasePolicy: {
    humanReleaseRequired: boolean;
    commitAllowedAfterApproval: boolean;
    pushAllowedAfterApproval: boolean;
  };
  requestedCapabilities?: string[];
  createdAt: string;
}
```

## Principles

- task describes outcome and constraints, not provider identity
- provider names are forbidden as required capabilities
- repository/ref/scope must be explicit enough to create safe worktrees
- assurance may be raised by policy but not silently lowered
- humanReleaseRequired defaults true for EO-01
- missing critical scope/policy fails closed

## AOE handoff

AOE may generate EngineeringTask after orientation/decision logic. VITO remains responsible for operational planning, provider routing, execution governance and release gates.

## Human submission

Human-created tasks use the same contract. No parallel 'manual engineering workflow' contract should be introduced.

## Required validation

- tenant/organization required
- repository target required
- non-empty requestedOutcome
- at least one acceptance criterion for governed build tasks
- assurance enum valid
- budget monetary value requires currency
- dangerous release policy cannot bypass human gate
- provider-specific capability codes rejected

## Required tests

- valid AOE task accepted
- valid human task accepted
- missing targetRef rejected
- empty acceptance criteria rejected for build workflow
- provider-specific capability rejected
- requested AL4 remains AL4 or can be raised by future policy, never lowered automatically
