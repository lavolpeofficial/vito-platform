import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { CommandHandler, CommandResult, VitoCommand } from './command-bus.types';

export interface CommandDispatchRequest {
  commandType: string;
  parameters: Record<string, unknown>;
}

export interface CommandActorContext {
  organizationId: string;
  userId: string | null;
  role: UserRole | null;
  authenticationMethod: 'jwt' | 'insecure-header';
}

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

  async dispatchRequest(request: CommandDispatchRequest, actor: CommandActorContext): Promise<CommandResult> {
    const handler = this.handlers.get(request.commandType);
    const command: VitoCommand = {
      commandId: randomUUID(),
      commandType: request.commandType,
      organizationId: actor.organizationId,
      requestedBy: actor.userId ?? 'anonymous',
      target: handler?.target ?? 'UNRESOLVED',
      parameters: request.parameters,
      approvalLevel: handler?.requiredApprovalLevel ?? 'L5',
      correlationId: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // The insecure development header is not an authenticated tenant boundary.
    // Do not write a tenant-scoped audit event from an unverified organizationId.
    if (actor.authenticationMethod !== 'jwt' || !actor.userId || !actor.role) {
      return this.result(command, 'REJECTED', undefined, 'JWT_AUTH_REQUIRED');
    }

    if (!handler) {
      return this.reject(command, 'HANDLER_NOT_FOUND');
    }

    if (!this.isRoleAuthorized(actor.role, handler.requiredApprovalLevel)) {
      return this.reject(command, 'COMMAND_POLICY_DENIED');
    }

    if (handler.requiredApprovalLevel === 'L4' || handler.requiredApprovalLevel === 'L5') {
      return this.reject(command, 'APPROVAL_WORKFLOW_REQUIRED');
    }

    return this.dispatchResolved(command, handler);
  }

  private isRoleAuthorized(role: UserRole, level: VitoCommand['approvalLevel']): boolean {
    if (level === 'L0') return true;
    if (level === 'L1') return role !== UserRole.VIEWER;
    if (level === 'L2' || level === 'L3') return role === UserRole.OWNER || role === UserRole.ADMIN;
    return role === UserRole.OWNER;
  }

  private async dispatchResolved(command: VitoCommand, handler: CommandHandler): Promise<CommandResult> {
    await this.audit.record({
      organizationId: command.organizationId,
      actorType: 'USER',
      actorId: command.requestedBy,
      action: 'COMMAND.STARTED',
      entityType: 'COMMAND',
      entityId: command.commandId,
      metadata: {
        commandType: command.commandType,
        target: command.target,
        correlationId: command.correlationId,
        approvalLevel: command.approvalLevel,
      },
    });

    try {
      const data = await handler.execute(command);
      await this.audit.record({
        organizationId: command.organizationId,
        actorType: 'USER',
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
        actorType: 'USER',
        actorId: command.requestedBy,
        action: 'COMMAND.FAILED',
        entityType: 'COMMAND',
        entityId: command.commandId,
        metadata: { commandType: command.commandType, correlationId: command.correlationId, reason },
      });
      return this.result(command, 'FAILED', undefined, reason);
    }
  }

  private async reject(command: VitoCommand, reason: string): Promise<CommandResult> {
    await this.audit.record({
      organizationId: command.organizationId,
      actorType: 'USER',
      actorId: command.requestedBy,
      action: 'COMMAND.REJECTED',
      entityType: 'COMMAND',
      entityId: command.commandId,
      metadata: {
        commandType: command.commandType,
        target: command.target,
        correlationId: command.correlationId,
        approvalLevel: command.approvalLevel,
        reason,
      },
    });
    return this.result(command, 'REJECTED', undefined, reason);
  }

  private result(command: VitoCommand, status: CommandResult['status'], data?: unknown, reason?: string): CommandResult {
    return {
      commandId: command.commandId,
      commandType: command.commandType,
      correlationId: command.correlationId,
      status,
      data,
      reason,
      completedAt: new Date().toISOString(),
    };
  }
}
