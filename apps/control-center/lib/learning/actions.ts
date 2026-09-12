'use server';

import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import {
  parseExperienceRecord,
  parseExperienceRecords,
  parseOutcomeRecords,
  parseReflectionRecords,
  type ExperienceRecord,
  type ExperienceStatus,
  type OutcomeRecord,
  type ReflectionRecord,
} from './contracts';

export type LearningSearchState = Readonly<{
  experiences: readonly ExperienceRecord[];
  selected: ExperienceRecord | null;
  outcomes: readonly OutcomeRecord[];
  reflections: readonly ReflectionRecord[];
  error: string | null;
}>;

const statuses = new Set<ExperienceStatus>(['OBSERVED', 'EVALUATED', 'REFLECTED', 'LEARNING_CANDIDATE', 'ARCHIVED']);

export async function loadLearning(_previous: LearningSearchState, formData: FormData): Promise<LearningSearchState> {
  const agentId = String(formData.get('agentId') ?? '').trim();
  const statusRaw = String(formData.get('status') ?? '').trim();
  const experienceId = String(formData.get('experienceId') ?? '').trim();
  if (statusRaw && !statuses.has(statusRaw as ExperienceStatus)) return empty('STATUS_INVALID');

  try {
    const client = await createAuthenticatedVitoApiClient();
    if (experienceId) {
      const selected = await client.get(`/learning-observability/experiences/${encodeURIComponent(experienceId)}`, parseExperienceRecord);
      const [outcomes, reflections] = await Promise.all([
        client.get(`/learning-observability/experiences/${encodeURIComponent(experienceId)}/outcomes`, parseOutcomeRecords),
        client.get(`/learning-observability/experiences/${encodeURIComponent(experienceId)}/reflections`, parseReflectionRecords),
      ]);
      return { experiences: [], selected, outcomes, reflections, error: null };
    }

    const params = new URLSearchParams({ limit: '50' });
    if (agentId) params.set('agentId', agentId);
    if (statusRaw) params.set('status', statusRaw);
    const experiences = await client.get(`/learning-observability/experiences?${params.toString()}`, parseExperienceRecords);
    return { experiences, selected: null, outcomes: [], reflections: [], error: null };
  } catch (caught) {
    return empty(caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR');
  }
}

function empty(error: string): LearningSearchState {
  return { experiences: [], selected: null, outcomes: [], reflections: [], error };
}
