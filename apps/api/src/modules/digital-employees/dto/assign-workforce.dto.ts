import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignWorkforceDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Workforce-Zuordnung. Ohne Wert wird der DigitalEmployee aus seiner Workforce entfernt.',
  })
  @IsOptional()
  @IsUUID()
  workforceInstanceId?: string | null;
}
