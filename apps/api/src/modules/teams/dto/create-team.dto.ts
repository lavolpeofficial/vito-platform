import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TeamStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workforceInstanceId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departmentId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  managerEmployeeId?: string;

  @ApiProperty({ example: 'SEO' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  code!: string;

  @ApiProperty({ example: 'SEO Team' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Verantwortlich für technische und redaktionelle SEO.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: TeamStatus, default: TeamStatus.DRAFT })
  @IsOptional()
  @IsEnum(TeamStatus)
  status?: TeamStatus;
}
