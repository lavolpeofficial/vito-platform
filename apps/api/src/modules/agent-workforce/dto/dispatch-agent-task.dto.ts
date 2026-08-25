import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DispatchAgentTaskDto {
  @IsUUID()
  workflowRunId!: string;

  @IsUUID()
  workflowStepRunId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  capabilityCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(524288)
  prompt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assuranceLevel?: string;

  @IsOptional()
  @IsUUID()
  correlationId?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(3_600_000)
  maxDurationMs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxTokens?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  maxCostMinorUnits?: number;
}
