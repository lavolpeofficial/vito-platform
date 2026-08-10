import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateDigitalEmployeeDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  capabilitiesReviewed!: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  dataAccessReviewed!: boolean;

  @ApiProperty({ example: 'Approved after reviewing capabilities, data access and human gates.' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  approvalNote!: string;
}
