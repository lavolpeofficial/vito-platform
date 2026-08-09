import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SourceConfidentiality,
  SourceRightsStatus,
  SourceType,
} from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UploadSourceDto {
  @ApiProperty({ enum: SourceType })
  @IsEnum(SourceType)
  sourceType!: SourceType;

  @ApiProperty({ example: 'system:upload' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  ingestedBy!: string;

  @ApiPropertyOptional({ example: 'KI-CONSULTANT' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  projectKey?: string;

  @ApiPropertyOptional({ example: 'consulting' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  domain?: string;

  @ApiPropertyOptional({ example: 'de' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @ApiPropertyOptional({ example: 'SheetGPT HR Modul' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional({ example: 'Digital Beat GmbH' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  author?: string;

  @ApiPropertyOptional({ description: 'ISO-8601 Zeitstempel des fachlichen Quelldatums.' })
  @IsOptional()
  @IsISO8601()
  sourceDate?: string;

  @ApiPropertyOptional({ enum: SourceConfidentiality, default: SourceConfidentiality.INTERNAL })
  @IsOptional()
  @IsEnum(SourceConfidentiality)
  confidentiality?: SourceConfidentiality;

  @ApiPropertyOptional({ enum: SourceRightsStatus, default: SourceRightsStatus.UNKNOWN })
  @IsOptional()
  @IsEnum(SourceRightsStatus)
  rightsStatus?: SourceRightsStatus;

  @ApiPropertyOptional({ example: 'business-record' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  retentionClass?: string;

  @ApiPropertyOptional({ description: 'UUID einer älteren Source-Version desselben logischen Dokuments.' })
  @IsOptional()
  @IsString()
  supersedesSourceId?: string;

  @ApiPropertyOptional({ description: 'UUID einer Parent-Source, z. B. Archiv oder E-Mail-Anhang.' })
  @IsOptional()
  @IsString()
  parentSourceId?: string;
}
