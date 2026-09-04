import { ApiPropertyOptional } from '@nestjs/swagger';
import { DepartmentStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateDepartmentDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  managerEmployeeId?: string | null;

  @ApiPropertyOptional({ example: 'Marketing & Growth' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'Verantwortet Marke, Sichtbarkeit und Wachstum.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: DepartmentStatus })
  @IsOptional()
  @IsEnum(DepartmentStatus)
  status?: DepartmentStatus;
}
