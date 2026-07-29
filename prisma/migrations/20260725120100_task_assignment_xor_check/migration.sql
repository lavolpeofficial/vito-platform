-- Erzwingt die Task-Assignment-Invariante zusätzlich auf Datenbankebene:
-- Eine Task darf niemals gleichzeitig "assignedUserId" UND
-- "assignedDigitalEmployeeId" gesetzt haben. Die gleiche Regel wird
-- bereits in TasksService.resolveAssignmentTarget() auf Anwendungsebene
-- durchgesetzt; siehe docs/adr/002-task-assignment-db-check-constraint.md
-- für die Begründung dieser zusätzlichen Absicherung.

-- AddCheckConstraint
ALTER TABLE "tasks"
  ADD CONSTRAINT "task_assignment_xor_check"
  CHECK (
    "assignedUserId" IS NULL
    OR "assignedDigitalEmployeeId" IS NULL
  );
