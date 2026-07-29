import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ description: 'Mindestens 12 Zeichen (siehe seed.ts-Konvention aus Sprint 2).' })
  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}
