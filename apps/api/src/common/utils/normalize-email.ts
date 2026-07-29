/**
 * Zentrale E-Mail-Normalisierung (Sprint 3A, siehe
 * docs/design/sprint-3-user-management-design.md, Kap. 2.1).
 *
 * Wird von JEDEM Pfad genutzt, der eine E-Mail-Adresse vor einem
 * DB-Lookup oder -Schreibvorgang entgegennimmt (Login, User-Anlage über
 * POST /users), damit "Jane@Example.com", " jane@example.com " und
 * "jane@example.com" konsistent auf denselben Datensatz auflösen.
 *
 * Bewusst eine einzige, zentrale Implementierung statt mehrerer lokaler
 * Kopien in einzelnen Services.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
