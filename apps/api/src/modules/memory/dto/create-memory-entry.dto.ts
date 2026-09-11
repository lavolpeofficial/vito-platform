import { IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

const MEMORY_KINDS = ['EPISODIC', 'SEMANTIC', 'PROCEDURAL', 'ORGANIZATIONAL'] as const;
const MEMORY_SCOPES = ['GLOBAL', 'ORGANIZATION', 'PROJECT', 'CUSTOMER', 'AGENT', 'WORKFLOW'] as const;

export class CreateMemoryEntryDto {
  @IsIn(MEMORY_KINDS)
  kind!: (typeof MEMORY_KINDS)[number];

  @IsIn(MEMORY_SCOPES)
  scope!: (typeof MEMORY_SCOPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(256)
  scopeId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(16_000)
  content!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  sourceType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  sourceRef?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
