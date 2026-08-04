import { ApiPropertyOptional } from '@nestjs/swagger';
import { PositionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdatePositionDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  workforceInstanceId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  teamId?: string | null;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationRoleId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  managerPositionId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsUUID()
  occupantEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: PositionStatus })
  @IsOptional()
  @IsEnum(PositionStatus)
  status?: PositionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLeadership?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetResponsibility?: number | null;
}
