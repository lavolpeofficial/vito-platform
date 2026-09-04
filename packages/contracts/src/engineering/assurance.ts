/**
 * Assurance Levels für den Engineering Runtime.
 *
 * AssuranceLevel ist eine Prüfanforderung, keine Qualitätsbewertung.
 * Höhere Level erfordern die Anforderungen der niedrigeren Level mit.
 */
export enum AssuranceLevel {
  /** Builder + deterministische Tests */
  AL1 = 'AL1',
  /** AL1 + mindestens ein unabhängiger Review */
  AL2 = 'AL2',
  /** AL2 + adversarial Red Team + Findings Resolution + Re-Review nach materieller Änderung */
  AL3 = 'AL3',
  /** AL3 + mindestens zwei unabhängige Reviewer + mindestens zwei unterschiedliche Modellfamilien + Human Release Gate zwingend */
  AL4 = 'AL4',
}
