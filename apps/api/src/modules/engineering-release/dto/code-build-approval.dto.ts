import { IsDateString, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const FEATURE_BRANCH = /^feat\/[a-z0-9][a-z0-9-]*$/;

export class CreateCodeBuildApprovalDto {
  @IsString() @IsNotEmpty() @MaxLength(200) missionId!: string;
  @IsString() @Matches(/^lavolpeofficial\/vito-platform$/) repository!: string;
  @IsString() @Matches(FEATURE_BRANCH) branch!: string;
  @IsDateString({ strict: true }) expiresAt!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) requestKey!: string;
}

export class ConsumeCodeBuildApprovalDto {
  @IsString() @IsNotEmpty() @MaxLength(200) missionId!: string;
  @IsString() @Matches(/^lavolpeofficial\/vito-platform$/) repository!: string;
  @IsString() @Matches(FEATURE_BRANCH) branch!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) requestKey!: string;
}
