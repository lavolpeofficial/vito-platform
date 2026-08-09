import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SourceDerivationType, SourceLocatorType } from '@prisma/client';
import { IsEnum, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class LinkKnowledgeSourceDto {
  @ApiProperty({ example: 'knowledge/consulting/assessment-capability-field-dictionary-v0.1.md' })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  knowledgeRef!: string;

  @ApiProperty({ enum: SourceDerivationType })
  @IsEnum(SourceDerivationType)
  derivationType!: SourceDerivationType;

  @ApiPropertyOptional({ enum: SourceLocatorType })
  @IsOptional()
  @IsEnum(SourceLocatorType)
  locatorType?: SourceLocatorType;

  @ApiPropertyOptional({ example: 'Structured Interview!A1:K30' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  locatorValue?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, example: 0.95 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
