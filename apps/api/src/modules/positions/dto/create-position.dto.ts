import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PositionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePositionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workforceInstanceId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  organizationRoleId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  managerPositionId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  occupantEmployeeId?: string;

  @ApiProperty({ example: 'HEAD_OF_SEO' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  code!: string;

  @ApiProperty({ example: 'Head of SEO' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: PositionStatus, default: PositionStatus.DRAFT })
  @IsOptional()
  @IsEnum(PositionStatus)
  status?: PositionStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isLeadership?: boolean;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetResponsibility?: number;
}
