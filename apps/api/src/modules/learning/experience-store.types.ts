export type ExperienceStatus =
  | 'OBSERVED'
  | 'EVALUATED'
  | 'REFLECTED'
  | 'LEARNING_CANDIDATE'
  | 'ARCHIVED';

export interface ExperienceRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly goal: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly decision: Readonly<Record<string, unknown>>;
  readonly action: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  readonly successScore: number | null;
  readonly confidence: number | null;
  readonly feedback: Readonly<Record<string, unknown>> | null;
  readonly lesson: string | null;
  readonly reusablePattern: Readonly<Record<string, unknown>> | null;
  readonly status: ExperienceStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RecordExperienceInput {
  readonly agentId: string;
  readonly goal: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly observation: Readonly<Record<string, unknown>>;
  readonly decision: Readonly<Record<string, unknown>>;
  readonly action: Readonly<Record<string, unknown>>;
  readonly result: Readonly<Record<string, unknown>>;
  readonly successScore?: number | null;
  readonly confidence?: number | null;
  readonly feedback?: Readonly<Record<string, unknown>> | null;
  readonly lesson?: string | null;
  readonly reusablePattern?: Readonly<Record<string, unknown>> | null;
  readonly status?: ExperienceStatus;
}

export interface ExperienceSearchQuery {
  readonly agentId?: string;
  readonly statuses?: readonly ExperienceStatus[];
  readonly limit?: number;
}

export interface ExperienceRepository {
  agentBelongsToOrganization(organizationId: string, agentId: string): Promise<boolean>;
  create(organizationId: string, input: RecordExperienceInput): Promise<ExperienceRecord>;
  getById(organizationId: string, experienceId: string): Promise<ExperienceRecord | null>;
  search(organizationId: string, query: ExperienceSearchQuery): Promise<readonly ExperienceRecord[]>;
}

export const EXPERIENCE_REPOSITORY = Symbol('EXPERIENCE_REPOSITORY');
