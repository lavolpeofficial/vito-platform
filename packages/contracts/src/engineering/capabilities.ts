/**
 * Providerunabhängige Capability-Taxonomie für den Engineering Runtime.
 *
 * Capabilities beschreiben Fähigkeiten, keine konkreten Provider.
 * Provider-Namen dürfen NICHT Bestandteil der Capability werden.
 *
 * Verboten: CLAUDE_REVIEW, OPENCODE_BUILD, CODEX_RED_TEAM
 * Erlaubt: CODE_PLAN, CODE_BUILD, TEST_EXECUTION, ...
 */
export enum EngineeringCapability {
  CODE_PLAN = 'CODE_PLAN',
  CODE_BUILD = 'CODE_BUILD',
  TEST_EXECUTION = 'TEST_EXECUTION',
  REVIEW_PACKAGE = 'REVIEW_PACKAGE',
  CODE_REVIEW = 'CODE_REVIEW',
  RED_TEAM = 'RED_TEAM',
  SECURITY_REVIEW = 'SECURITY_REVIEW',
  ARCHITECTURE_REVIEW = 'ARCHITECTURE_REVIEW',
  RELEASE_VERIFICATION = 'RELEASE_VERIFICATION',
}
