import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner@aterima.io' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @ApiProperty({ example: 'aterima', description: 'Slug der Organization, in der eingeloggt werden soll.' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'organizationSlug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.',
  })
  organizationSlug!: string;
}
