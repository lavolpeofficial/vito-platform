import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateTaskDto {
  @ApiPropertyOptional({ example: 'Lead-Anfrage final prüfen' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'UUID eines Users in derselben Organization. null entfernt die Zuweisung.', nullable: true })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @ApiPropertyOptional({ description: 'UUID eines DigitalEmployee in derselben Organization. null entfernt die Zuweisung.', nullable: true })
  @IsOptional()
  @IsUUID()
  assignedDigitalEmployeeId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;
}
