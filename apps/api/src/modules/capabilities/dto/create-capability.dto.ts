import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RiskLevel } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCapabilityDto {
  @ApiProperty({ example: 'lead.read', description: 'Eindeutig innerhalb der Organization.' })
  @IsString()
  @Matches(/^[a-z0-9]+(\.[a-z0-9]+)*$/, {
    message: 'code muss aus Kleinbuchstaben/Ziffern getrennt durch Punkte bestehen, z. B. lead.read.',
  })
  @MaxLength(120)
  code!: string;

  @ApiProperty({ example: 'Lead lesen' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'Erlaubt das Lesen von Lead-Daten über einen Adapter.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: RiskLevel, default: RiskLevel.LOW })
  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}
