export enum OperatorTaskStatus {
  DISPATCHING = 'DISPATCHING',
  COMPLETED = 'COMPLETED',
  HUMAN_GATE = 'HUMAN_GATE',
  FAILED = 'FAILED',
}

export interface OperatorTaskError {
  readonly reason: string;
  readonly message: string;
  readonly retryable: boolean;
}
