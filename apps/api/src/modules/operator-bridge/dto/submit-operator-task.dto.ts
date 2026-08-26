import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const MAX_OPERATOR_PROMPT_BYTES = 512 * 1024;

const preservePlainValue = Transform(({ obj, key }) => obj[key], { toClassOnly: true });

@ValidatorConstraint({ name: 'boundedOperatorPrompt', async: false })
export class BoundedOperatorPromptConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      value.trim().length > 0 &&
      Buffer.byteLength(value, 'utf8') <= MAX_OPERATOR_PROMPT_BYTES
    );
  }

  defaultMessage(): string {
    return `prompt must be non-empty and at most ${MAX_OPERATOR_PROMPT_BYTES} UTF-8 bytes`;
  }
}

export class SubmitOperatorBudgetDto {
  @ApiPropertyOptional({ minimum: 1000, maximum: 3_600_000 })
  @ValidateIf((_, value) => value !== undefined)
  @preservePlainValue
  @IsInt()
  @Min(1000)
  @Max(3_600_000)
  maxDurationMs?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10_000_000 })
  @ValidateIf((_, value) => value !== undefined)
  @preservePlainValue
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxTokens?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000_000 })
  @ValidateIf((_, value) => value !== undefined)
  @preservePlainValue
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  maxCostMinorUnits?: number;
}

export class SubmitOperatorTaskDto {
  @ApiProperty({ format: 'uuid', description: 'Client-generated idempotency key.' })
  @preservePlainValue
  @IsUUID()
  requestId!: string;

  @ApiProperty({ maxLength: 128, example: 'CODE_BUILD' })
  @preservePlainValue
  @IsString()
  @MaxLength(128)
  @Matches(/\S/, { message: 'capabilityCode must be a non-empty string' })
  capabilityCode!: string;

  @ApiProperty({
    description: `Non-empty operator instruction, bounded to ${MAX_OPERATOR_PROMPT_BYTES} UTF-8 bytes.`,
  })
  @preservePlainValue
  @IsString()
  @Validate(BoundedOperatorPromptConstraint)
  prompt!: string;

  @ApiPropertyOptional({ maxLength: 64, example: 'AL-3' })
  @ValidateIf((_, value) => value !== undefined)
  @preservePlainValue
  @IsString()
  @MaxLength(64)
  assuranceLevel?: string;

  @ApiPropertyOptional({ type: SubmitOperatorBudgetDto })
  @ValidateIf((_, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => SubmitOperatorBudgetDto)
  budget?: SubmitOperatorBudgetDto;
}
