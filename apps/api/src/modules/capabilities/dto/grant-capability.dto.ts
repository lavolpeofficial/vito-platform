import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional } from 'class-validator';

export class GrantCapabilityDto {
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Freie JSON-Konfiguration für diese Capability.', example: {} })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}
