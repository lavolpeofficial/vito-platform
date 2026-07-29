import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { TaskPriority } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTaskDto {
  @ApiProperty({ example: 'Lead-Anfrage prüfen' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: 'Eingehende Anfrage bewerten und Task ggf. weiterleiten.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.NORMAL })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'UUID eines Users in derselben Organization.' })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @ApiPropertyOptional({ description: 'UUID eines DigitalEmployee in derselben Organization.' })
  @IsOptional()
  @IsUUID()
  assignedDigitalEmployeeId?: string;

  @ApiPropertyOptional({ description: 'UUID des erstellenden Users, sofern bekannt.' })
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  @ApiPropertyOptional({ example: '2026-08-01T09:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
