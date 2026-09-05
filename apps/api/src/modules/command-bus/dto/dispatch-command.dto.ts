import { IsObject, IsString, Matches, MaxLength } from 'class-validator';

export class DispatchCommandDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Z0-9_.-]+$/)
  commandType!: string;

  @IsObject()
  parameters!: Record<string, unknown>;
}
