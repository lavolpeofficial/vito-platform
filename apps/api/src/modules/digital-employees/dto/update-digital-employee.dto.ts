import { ApiPropertyOptional } from '@nestjs/swagger';
import { DigitalEmployeeStatus, EmployeeType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateDigitalEmployeeDto {
  @ApiPropertyOptional({ example: 'TIMO' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'Orchestrator für ATERIMA-Prozesse.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: EmployeeType })
  @IsOptional()
  @IsEnum(EmployeeType)
  employeeType?: EmployeeType;

  @ApiPropertyOptional({ enum: DigitalEmployeeStatus })
  @IsOptional()
  @IsEnum(DigitalEmployeeStatus)
  status?: DigitalEmployeeStatus;

  @ApiPropertyOptional({ example: '0.2.0' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version muss dem Format x.y.z entsprechen.' })
  version?: string;
}
