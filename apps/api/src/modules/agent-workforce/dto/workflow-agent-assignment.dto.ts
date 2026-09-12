import { EngineeringStepType } from '@vito/contracts';
import { IsEnum, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ApproveWorkflowAgentAssignmentDto {
  @IsEnum(EngineeringStepType)
  stepType!: EngineeringStepType;

  @IsUUID()
  digitalEmployeeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  approvalRef!: string;
}
