-- Fügt die für Sprint 2 (Authentifizierung) zwingend erforderlichen Felder
-- zum User-Modell hinzu. Bestehende Migrationen werden nicht verändert.
--
-- "passwordHash" ist bewusst NULLABLE: Über POST /users angelegte User
-- (Status meist INVITED) erhalten in diesem Sprint noch kein Passwort;
-- sie können erst einloggen, sobald ein zukünftiger "Invite annehmen"-Flow
-- (außerhalb dieses Sprints) ihnen eines setzt. AuthService.login()
-- behandelt einen fehlenden passwordHash wie ein falsches Passwort
-- (generische 401-Antwort, kein Informationsleck).

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "lastLoginAt" TIMESTAMP(3);
