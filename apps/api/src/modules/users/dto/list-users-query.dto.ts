import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Sichere Obergrenze für `take`, um unbeabsichtigt große Antworten zu verhindern. */
export const MAX_USERS_TAKE = 100;
export const DEFAULT_USERS_TAKE = 20;

export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_USERS_TAKE, maximum: MAX_USERS_TAKE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_USERS_TAKE)
  take?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    default: false,
    description: 'Ohne dieses Flag werden DISABLED-User standardmäßig ausgeblendet.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDisabled?: boolean;
}
