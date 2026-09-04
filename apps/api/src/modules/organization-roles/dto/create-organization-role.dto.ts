import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationRoleStatus } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationRoleDto {
  @ApiProperty({ example: 'MARKETING_SPECIALIST' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  code!: string;

  @ApiProperty({ example: 'Marketing Specialist' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: OrganizationRoleStatus, default: OrganizationRoleStatus.DRAFT })
  @IsOptional()
  @IsEnum(OrganizationRoleStatus)
  status?: OrganizationRoleStatus;

  @ApiPropertyOptional({ type: [String], example: ['Plan marketing activities', 'Review campaign performance'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  responsibilities?: string[];
}
