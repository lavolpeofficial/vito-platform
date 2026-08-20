/**
 * Workflow- und Step-Status für den Engineering Runtime.
 *
 * WorkflowRunStatus beschreibt den Gesamtzustand eines Workflows.
 * WorkflowStepStatus beschreibt den Zustand einzelner Schritte.
 *
 * Die beiden Ebenen dürfen nicht vermischt werden.
 */

/** Gesamtzustand eines Engineering-Workflow-Runs */
export enum WorkflowRunStatus {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  WAITING_FOR_HUMAN = 'WAITING_FOR_HUMAN',
  BLOCKED = 'BLOCKED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Zustand einzelner Schritte innerhalb eines Runs */
export enum WorkflowStepStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  RUNNING = 'RUNNING',
  WAITING = 'WAITING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  CANCELLED = 'CANCELLED',
}

/** Typen von Engineering-Schritten */
export enum EngineeringStepType {
  PLAN = 'PLAN',
  BUILD = 'BUILD',
  TEST = 'TEST',
  PACKAGE = 'PACKAGE',
  RED_TEAM = 'RED_TEAM',
  PARSE_VERDICT = 'PARSE_VERDICT',
  CORRECTION = 'CORRECTION',
  VERIFY = 'VERIFY',
  HUMAN_RELEASE_GATE = 'HUMAN_RELEASE_GATE',
  RELEASE_EXECUTION = 'RELEASE_EXECUTION',
  REMOTE_VERIFY = 'REMOTE_VERIFY',
}
