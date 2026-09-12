import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ProposeSkillPromotionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  targetCapabilityCode!: string;
}

export class ReviewSkillPromotionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  rationale!: string;
}

export const SKILL_PROMOTION_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED_FOR_REGISTRATION',
  'REJECTED',
] as const;

export class SkillPromotionListQueryDto {
  @IsOptional()
  @IsIn(SKILL_PROMOTION_STATUSES)
  status?: (typeof SKILL_PROMOTION_STATUSES)[number];
}
