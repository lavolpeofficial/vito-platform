import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DigitalEmployeeStatus, EmployeeType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateDigitalEmployeeDto {
  @ApiProperty({ example: 'TIMO' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'timo', description: 'Eindeutig innerhalb der Organization.' })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'code darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.',
  })
  @MaxLength(60)
  code!: string;

  @ApiPropertyOptional({ example: 'Orchestrator für ATERIMA-Prozesse.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: EmployeeType, example: EmployeeType.ORCHESTRATOR })
  @IsEnum(EmployeeType)
  employeeType!: EmployeeType;

  @ApiPropertyOptional({ enum: DigitalEmployeeStatus, default: DigitalEmployeeStatus.DRAFT })
  @IsOptional()
  @IsEnum(DigitalEmployeeStatus)
  status?: DigitalEmployeeStatus;

  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version muss dem Format x.y.z entsprechen.' })
  version!: string;
}
