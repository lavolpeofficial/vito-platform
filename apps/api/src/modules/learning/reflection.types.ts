export type ReflectionActorType = 'SYSTEM' | 'USER' | 'EXTERNAL';

export interface ReflectionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly experienceId: string;
  readonly lesson: string;
  readonly whatWorked: readonly string[];
  readonly whatFailed: readonly string[];
  readonly assumptions: readonly string[];
  readonly nextActionHint: string | null;
  readonly evidenceOutcomeIds: readonly string[];
  readonly confidence: number | null;
  readonly reflectorType: ReflectionActorType;
  readonly reflectorId: string | null;
  readonly createdAt: Date;
}

export interface RecordReflectionInput {
  readonly experienceId: string;
  readonly lesson: string;
  readonly whatWorked?: readonly string[];
  readonly whatFailed?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly nextActionHint?: string | null;
  readonly evidenceOutcomeIds: readonly string[];
  readonly confidence?: number | null;
  readonly reflectorType?: ReflectionActorType;
  readonly reflectorId?: string | null;
}

export interface ReflectionRepository {
  create(organizationId: string, input: RecordReflectionInput): Promise<ReflectionRecord>;
  listForExperience(organizationId: string, experienceId: string): Promise<readonly ReflectionRecord[]>;
  markExperienceReflected(organizationId: string, experienceId: string): Promise<void>;
}

export const REFLECTION_REPOSITORY = Symbol('REFLECTION_REPOSITORY');
