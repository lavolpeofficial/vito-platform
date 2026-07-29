-- Sprint 3A (User Administration): Soft-Delete-Felder für "users".
--
-- deletedByUserId referenziert users.id selbst (echte, benannte
-- Self-Relation "UserDeletedBy" in prisma/schema.prisma) statt eines
-- losen Strings, siehe docs/design/sprint-3-user-management-design.md,
-- Kap. 6.1, für die Begründung (Konsistenz mit den bestehenden
-- Task.assignedUserId/createdByUserId-Relationen, kein Kaskadenrisiko
-- bei reinem Soft Delete). ON DELETE SET NULL ist der Prisma-Default
-- für optionale Relationen (unverändert zum bestehenden Muster bei
-- tasks.assignedUserId), hier zur Klarheit explizit gesetzt.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "users_deletedByUserId_idx" ON "users"("deletedByUserId");

-- AddForeignKey
ALTER TABLE "users"
  ADD CONSTRAINT "users_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
