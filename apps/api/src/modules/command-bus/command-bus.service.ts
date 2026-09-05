import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { CommandHandler, CommandResult, VitoCommand } from './command-bus.types';

@Injectable()
export class CommandBusService {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(private readonly audit: AuditService) {}

  register(handler: CommandHandler): void {
    if (this.handlers.has(handler.commandType)) {
      throw new Error(`Duplicate command handler: ${handler.commandType}`);
    }
    this.handlers.set(handler.commandType, handler);
  }

  async dispatch(command: VitoCommand): Promise<CommandResult> {
    const handler = this.handlers.get(command.commandType);
    if (!handler) {
      await this.audit.record({
        organizationId: command.organizationId,
        actorType: 'SYSTEM',
        actorId: command.requestedBy,
        action: 'COMMAND.REJECTED',
        entityType: 'COMMAND',
        entityId: command.commandId,
        metadata: { commandType: command.commandType, correlationId: command.correlationId, reason: 'HANDLER_NOT_FOUND' },
      });
      return this.result(command, 'REJECTED', undefined, 'HANDLER_NOT_FOUND');
    }

    if (!['L0', 'L1', 'L2', 'L3'].includes(command.approvalLevel)) {
      await this.audit.record({
        organizationId: command.organizationId,
        actorType: 'SYSTEM',
        actorId: command.requestedBy,
        action: 'COMMAND.REJECTED',
        entityType: 'COMMAND',
        entityId: command.commandId,
        metadata: { commandType: command.commandType, correlationId: command.correlationId, approvalLevel: command.approvalLevel, reason: 'APPROVAL_REQUIRED' },
      });
      return this.result(command, 'REJECTED', undefined, 'APPROVAL_REQUIRED');
    }

    await this.audit.record({
      organizationId: command.organizationId,
      actorType: 'SYSTEM',
      actorId: command.requestedBy,
      action: 'COMMAND.STARTED',
      entityType: 'COMMAND',
      entityId: command.commandId,
      metadata: { commandType: command.commandType, target: command.target, correlationId: command.correlationId, approvalLevel: command.approvalLevel },
    });

    try {
      const data = await handler.execute(command);
      await this.audit.record({
        organizationId: command.organizationId,
        actorType: 'SYSTEM',
        actorId: command.requestedBy,
        action: 'COMMAND.SUCCEEDED',
        entityType: 'COMMAND',
        entityId: command.commandId,
        metadata: { commandType: command.commandType, correlationId: command.correlationId },
      });
      return this.result(command, 'SUCCEEDED', data);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'COMMAND_FAILED';
      await this.audit.record({
        organizationId: command.organizationId,
        actorType: 'SYSTEM',
        actorId: command.requestedBy,
        action: 'COMMAND.FAILED',
        entityType: 'COMMAND',
        entityId: command.commandId,
        metadata: { commandType: command.commandType, correlationId: command.correlationId, reason },
      });
      return this.result(command, 'FAILED', undefined, reason);
    }
  }

  private result(command: VitoCommand, status: CommandResult['status'], data?: unknown, reason?: string): CommandResult {
    return { commandId: command.commandId, commandType: command.commandType, correlationId: command.correlationId, status, data, reason, completedAt: new Date().toISOString() };
  }
}
