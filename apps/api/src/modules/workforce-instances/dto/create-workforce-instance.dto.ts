import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkforceStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkforceInstanceDto {
  @ApiProperty({ example: 'VITO' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'vito', description: 'Eindeutig innerhalb der Organization.' })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'code darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.',
  })
  @MaxLength(60)
  code!: string;

  @ApiPropertyOptional({ example: 'Digitale Workforce von LA VOLPE.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: WorkforceStatus, default: WorkforceStatus.DRAFT })
  @IsOptional()
  @IsEnum(WorkforceStatus)
  status?: WorkforceStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'DigitalEmployee vom Typ ORCHESTRATOR.' })
  @IsOptional()
  @IsUUID()
  orchestratorEmployeeId?: string;
}
