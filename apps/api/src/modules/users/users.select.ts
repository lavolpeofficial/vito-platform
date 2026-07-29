/**
 * Gemeinsame, sichere Feldauswahl für alle User-API-Antworten
 * (Sprint 3A). `passwordHash` wird NIEMALS zurückgegeben — weder über
 * GET/PATCH/DELETE /users(/:id) noch über POST /users.
 */
export const SAFE_USER_SELECT = {
  id: true,
  organizationId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  lastLoginAt: true,
  deletedAt: true,
  deletedByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;
