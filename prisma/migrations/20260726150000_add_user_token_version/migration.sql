-- Sprint 2.1 (Security Hardening): JWT Token Versioning.
--
-- Ergänzt "tokenVersion" auf "users", um bereits ausgestellte JWTs gezielt
-- entwerten zu können, ohne eine Blacklist zu pflegen (siehe
-- docs/adr/003-jwt-tenant-context-and-mvp-authorization.md, Abschnitt
-- "Token Versioning"). NOT NULL mit DEFAULT 1, damit bestehende Zeilen
-- ohne manuelle Nacharbeit gültig befüllt werden — vollständig
-- vorwärtskompatibel, keine vorherige Migration wird verändert.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 1;
