import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DigitalEmployeesService } from '../digital-employees/digital-employees.service';
import { UsersService } from '../users/users.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
    private readonly digitalEmployeesService: DigitalEmployeesService,
  ) {}

  async create(organizationId: string, dto: CreateTaskDto) {
    if (dto.assignedUserId && dto.assignedDigitalEmployeeId) {
      throw new BadRequestException(
        'Eine Task darf nicht gleichzeitig einem User und einem DigitalEmployee zugewiesen werden.',
      );
    }

    if (dto.assignedUserId) {
      await this.usersService.assertBelongsToOrganization(organizationId, dto.assignedUserId);
    }
    if (dto.assignedDigitalEmployeeId) {
      await this.digitalEmployeesService.assertBelongsToOrganization(organizationId, dto.assignedDigitalEmployeeId);
    }
    if (dto.createdByUserId) {
      await this.usersService.assertBelongsToOrganization(organizationId, dto.createdByUserId);
    }

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          organizationId,
          title: dto.title,
          description: dto.description,
          priority: dto.priority,
          assignedUserId: dto.assignedUserId,
          assignedDigitalEmployeeId: dto.assignedDigitalEmployeeId,
          createdByUserId: dto.createdByUserId,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'TASK_CREATED',
          entityType: 'Task',
          entityId: task.id,
          metadata: {
            title: task.title,
            assignedUserId: task.assignedUserId,
            assignedDigitalEmployeeId: task.assignedDigitalEmployeeId,
          },
        },
        tx,
      );

      return task;
    });
  }

  async findAll(organizationId: string) {
    return this.prisma.task.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrFail(organizationId: string, id: string) {
    const task = await this.prisma.task.findFirst({ where: { id, organizationId } });
    if (!task) {
      throw new NotFoundException('Task nicht gefunden.');
    }
    return task;
  }

  /**
   * Berechnet den resultierenden Zuweisungs-Zustand (Zielzustand) einer Task
   * aus dem bestehenden Zustand + den im PATCH-Body tatsächlich übergebenen
   * Feldern, und erzwingt dabei die Invariante "User XOR DigitalEmployee XOR
   * keine Zuweisung":
   *
   * - Felder, die im DTO nicht vorkommen (`undefined`), lassen den
   *   bestehenden Zustand unverändert.
   * - Ein Feld explizit auf `null` zu setzen, entfernt die jeweilige
   *   Zuweisung.
   * - Wird `assignedUserId` auf einen Wert gesetzt, ohne dass im selben
   *   Request `assignedDigitalEmployeeId` explizit adressiert wird, wird
   *   eine ggf. bestehende DigitalEmployee-Zuweisung automatisch entfernt
   *   (und umgekehrt).
   * - Werden beide Felder im selben Request explizit auf einen
   *   Nicht-null-Wert gesetzt, ist das ein unzulässiger Doppelzustand und
   *   wird abgelehnt (unabhängig vom bisherigen Task-Zustand).
   */
  private resolveAssignmentTarget(
    existing: { assignedUserId: string | null; assignedDigitalEmployeeId: string | null },
    dto: UpdateTaskDto,
  ): { assignedUserId: string | null; assignedDigitalEmployeeId: string | null } {
    const userProvided = dto.assignedUserId !== undefined;
    const deProvided = dto.assignedDigitalEmployeeId !== undefined;

    if (userProvided && deProvided && dto.assignedUserId !== null && dto.assignedDigitalEmployeeId !== null) {
      throw new BadRequestException(
        'Eine Task darf nicht gleichzeitig einem User und einem DigitalEmployee zugewiesen werden.',
      );
    }

    let targetUserId = userProvided ? dto.assignedUserId! : existing.assignedUserId;
    let targetDigitalEmployeeId = deProvided ? dto.assignedDigitalEmployeeId! : existing.assignedDigitalEmployeeId;

    // Wechsel auf einen User löscht automatisch eine bestehende
    // DigitalEmployee-Zuweisung, sofern diese im selben Request nicht
    // bereits explizit adressiert wurde.
    if (userProvided && dto.assignedUserId && !deProvided) {
      targetDigitalEmployeeId = null;
    }

    // Wechsel auf einen DigitalEmployee löscht automatisch eine bestehende
    // User-Zuweisung, sofern diese im selben Request nicht bereits
    // explizit adressiert wurde.
    if (deProvided && dto.assignedDigitalEmployeeId && !userProvided) {
      targetUserId = null;
    }

    // Verteidigungslinie: der Zielzustand darf niemals beide Zuweisungen
    // gleichzeitig enthalten, unabhängig vom Pfad, über den er berechnet
    // wurde.
    if (targetUserId && targetDigitalEmployeeId) {
      throw new BadRequestException(
        'Eine Task darf nicht gleichzeitig einem User und einem DigitalEmployee zugewiesen werden.',
      );
    }

    return { assignedUserId: targetUserId, assignedDigitalEmployeeId: targetDigitalEmployeeId };
  }

  async update(organizationId: string, id: string, dto: UpdateTaskDto) {
    const existing = await this.findByIdOrFail(organizationId, id);

    const target = this.resolveAssignmentTarget(existing, dto);

    if (target.assignedUserId && target.assignedUserId !== existing.assignedUserId) {
      await this.usersService.assertBelongsToOrganization(organizationId, target.assignedUserId);
    }
    if (
      target.assignedDigitalEmployeeId &&
      target.assignedDigitalEmployeeId !== existing.assignedDigitalEmployeeId
    ) {
      await this.digitalEmployeesService.assertBelongsToOrganization(
        organizationId,
        target.assignedDigitalEmployeeId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: {
          title: dto.title,
          description: dto.description,
          status: dto.status,
          priority: dto.priority,
          assignedUserId: target.assignedUserId,
          assignedDigitalEmployeeId: target.assignedDigitalEmployeeId,
          dueAt: dto.dueAt === null ? null : dto.dueAt ? new Date(dto.dueAt) : undefined,
        },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'TASK_UPDATED',
          entityType: 'Task',
          entityId: updated.id,
          metadata: {
            changes: dto,
            resultingAssignment: {
              assignedUserId: updated.assignedUserId,
              assignedDigitalEmployeeId: updated.assignedDigitalEmployeeId,
            },
          },
        },
        tx,
      );

      return updated;
    });
  }

  async complete(organizationId: string, id: string) {
    const task = await this.findByIdOrFail(organizationId, id);

    if (task.status === 'COMPLETED') {
      return task;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      await this.auditService.record(
        {
          organizationId,
          actorType: 'SYSTEM',
          action: 'TASK_COMPLETED',
          entityType: 'Task',
          entityId: updated.id,
          metadata: {},
        },
        tx,
      );

      return updated;
    });
  }
}
