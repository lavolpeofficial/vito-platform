import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateGoalPlanDto {
  @IsString()
  @Length(10, 2000)
  goal!: string;

  @IsOptional()
  @IsIn(['AL1', 'AL2', 'AL3', 'AL4'])
  assuranceLevel?: 'AL1' | 'AL2' | 'AL3' | 'AL4';
}
