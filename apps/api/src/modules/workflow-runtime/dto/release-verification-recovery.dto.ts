import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReleaseVerificationRecoveryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  approvalRef!: string;
}
