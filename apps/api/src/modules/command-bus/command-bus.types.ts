export type ApprovalLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface VitoCommand<TParameters = Readonly<Record<string, unknown>>> {
  commandId: string;
  commandType: string;
  organizationId: string;
  requestedBy: string;
  target: string;
  parameters: TParameters;
  approvalLevel: ApprovalLevel;
  correlationId: string;
  timestamp: string;
}

export interface CommandResult<TData = unknown> {
  commandId: string;
  commandType: string;
  correlationId: string;
  status: 'SUCCEEDED' | 'REJECTED' | 'FAILED';
  data?: TData;
  reason?: string;
  completedAt: string;
}

export interface CommandHandler<TData = unknown> {
  readonly commandType: string;
  readonly target: string;
  readonly requiredApprovalLevel: ApprovalLevel;
  execute(command: VitoCommand): Promise<TData>;
}
