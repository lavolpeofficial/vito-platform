import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OperatorTaskStatus } from '@vito/contracts';

export class SubmitOperatorTaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ format: 'uuid' })
  requestId!: string;

  @ApiProperty({ format: 'uuid' })
  correlationId!: string;

  @ApiProperty({ enum: OperatorTaskStatus })
  status!: OperatorTaskStatus;

  @ApiProperty({ type: String, nullable: true })
  routingDecisionId!: string | null;
}

class OperatorTaskProviderDto {
  @ApiProperty()
  providerCode!: string;

  @ApiProperty()
  displayName!: string;
}

class OperatorTaskErrorDto {
  @ApiProperty()
  reason!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  retryable!: boolean;
}

class OperatorTaskTimingDto {
  @ApiPropertyOptional({ format: 'date-time' })
  startedAt?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  completedAt?: string;

  @ApiPropertyOptional()
  durationMs?: number;
}

export class OperatorTaskResultDto {
  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ format: 'uuid' })
  requestId!: string;

  @ApiProperty({ enum: OperatorTaskStatus })
  status!: OperatorTaskStatus;

  @ApiProperty({ format: 'uuid' })
  correlationId!: string;

  @ApiProperty({ format: 'uuid' })
  workflowRunId!: string;

  @ApiProperty({ format: 'uuid' })
  workflowStepRunId!: string;

  @ApiPropertyOptional()
  invocationId?: string;

  @ApiPropertyOptional()
  executionId?: string;

  @ApiPropertyOptional({ type: OperatorTaskProviderDto })
  provider?: OperatorTaskProviderDto;

  @ApiProperty()
  capabilityCode!: string;

  @ApiProperty({ type: String, nullable: true })
  prompt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  stdout!: string | null;

  @ApiProperty({ type: String, nullable: true })
  stderr!: string | null;

  @ApiPropertyOptional({ type: [String] })
  changedFiles?: readonly string[];

  @ApiProperty({ type: String, nullable: true })
  patch!: string | null;

  @ApiPropertyOptional({ type: OperatorTaskErrorDto })
  error?: OperatorTaskErrorDto;

  @ApiPropertyOptional({ type: OperatorTaskTimingDto })
  timing?: OperatorTaskTimingDto;

  @ApiPropertyOptional({ enum: ['CLEANED'] })
  workspaceDisposition?: 'CLEANED';

  @ApiProperty()
  reviewRequired!: boolean;

  @ApiProperty()
  sensitivePayloadAvailable!: boolean;

  @ApiProperty({ format: 'date-time' })
  sensitivePayloadExpiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sensitivePayloadDeletedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
