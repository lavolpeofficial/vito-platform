/**
 * Artifact Types für den Engineering Runtime.
 *
 * Jeder Schritt im Workflow kann Artefakte erzeugen.
 * Artefakte werden noch nicht persistiert (Contract only).
 */
export enum ExecutionArtifactType {
  PLAN = 'PLAN',
  PATCH = 'PATCH',
  DIFF = 'DIFF',
  TEST_REPORT = 'TEST_REPORT',
  BUILD_LOG = 'BUILD_LOG',
  REVIEW_PACKAGE = 'REVIEW_PACKAGE',
  REVIEW_REPORT = 'REVIEW_REPORT',
  VERDICT = 'VERDICT',
  CORRECTION_REQUEST = 'CORRECTION_REQUEST',
  VERIFICATION_REPORT = 'VERIFICATION_REPORT',
  RELEASE_RECORD = 'RELEASE_RECORD',
}
