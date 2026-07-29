-- Sprint 3A (User Administration): erweitert "UserStatus" um den Wert
-- "DISABLED" (Soft-Delete-Marker, siehe DELETE /users/:id und
-- docs/design/sprint-3-user-management-design.md, Kap. 3/6).
--
-- Hinweis: ALTER TYPE ... ADD VALUE kann in PostgreSQL nicht in
-- derselben Transaktion verwendet werden, in der der neue Wert bereits
-- gelesen/geschrieben wird. Diese Migration fügt ausschließlich den
-- Enum-Wert hinzu; die nachfolgende Migration (add_user_soft_delete_fields)
-- und jeglicher Anwendungscode, der "DISABLED" tatsächlich benutzt,
-- laufen in eigenen, späteren Transaktionen/Deployments.

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'DISABLED';
