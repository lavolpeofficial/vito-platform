import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SourceConfidentiality,
  SourceExtractionStatus,
  SourceIngestionStatus,
  SourceRightsStatus,
  SourceType,
  SourceValidationStatus,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RegisterSourceDto {
  @ApiProperty({ enum: SourceType })
  @IsEnum(SourceType)
  sourceType!: SourceType;

  @ApiProperty({ example: 'SheetGPT_HR Modul.xlsx' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  originalFilename!: string;

  @ApiProperty({ example: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  mimeType!: string;

  @ApiProperty({ example: 184233 })
  @IsInt()
  @Min(0)
  byteSize!: number;

  @ApiProperty({ example: '6f1ed002ab5595859014ebf0951522d9f4d90a8d98abedc2f0e7f8a3e2334a21' })
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/, { message: 'sha256 muss ein 64-stelliger hexadezimaler SHA-256-Hash sein.' })
  sha256!: string;

  @ApiProperty({ example: 's3://source-vault/raw/tenant/source-id/original.xlsx' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  storageUri!: string;

  @ApiProperty({ example: 'system:ingest' })
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

  @ApiPropertyOptional({ enum: SourceIngestionStatus, default: SourceIngestionStatus.STORED })
  @IsOptional()
  @IsEnum(SourceIngestionStatus)
  ingestionStatus?: SourceIngestionStatus;

  @ApiPropertyOptional({ enum: SourceExtractionStatus, default: SourceExtractionStatus.NOT_STARTED })
  @IsOptional()
  @IsEnum(SourceExtractionStatus)
  extractionStatus?: SourceExtractionStatus;

  @ApiPropertyOptional({ enum: SourceValidationStatus, default: SourceValidationStatus.UNREVIEWED })
  @IsOptional()
  @IsEnum(SourceValidationStatus)
  validationStatus?: SourceValidationStatus;

  @ApiPropertyOptional({ description: 'UUID einer älteren Source-Version desselben logischen Dokuments.' })
  @IsOptional()
  @IsString()
  supersedesSourceId?: string;

  @ApiPropertyOptional({ description: 'UUID einer Parent-Source, z. B. Archiv oder E-Mail-Anhang.' })
  @IsOptional()
  @IsString()
  parentSourceId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
