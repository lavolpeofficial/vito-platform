import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Status-Werte, die in Sprint 3A über PATCH /users/:id gesetzt werden
 * dürfen. `DISABLED` wird ausschließlich über DELETE /users/:id
 * (Soft Delete) gesetzt; `LOCKED` existiert erst ab Sprint 3B und wird
 * dort ausschließlich automatisch bzw. manuell über einen erweiterten
 * Statuswert auf demselben Endpunkt ergänzt (siehe
 * docs/design/sprint-3-user-management-design.md, Kap. 4A.2/5).
 */
const ALLOWED_SPRINT_3A_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type Sprint3aUserStatus = (typeof ALLOWED_SPRINT_3A_STATUSES)[number];

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Jane' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: ALLOWED_SPRINT_3A_STATUSES,
    description: 'In Sprint 3A ausschließlich ACTIVE oder SUSPENDED.',
  })
  @IsOptional()
  @IsIn(ALLOWED_SPRINT_3A_STATUSES)
  status?: Sprint3aUserStatus;
}
