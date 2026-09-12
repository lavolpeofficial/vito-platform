'use server';

import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseGoalPlan, type AssuranceLevel, type GoalPlan } from './contracts';

export type GoalPlanningState = Readonly<{ plan: GoalPlan | null; error: string | null }>;
export const initialGoalPlanningState: GoalPlanningState = { plan: null, error: null };

export async function createGoalPlan(_previous: GoalPlanningState, formData: FormData): Promise<GoalPlanningState> {
  const rawGoal = formData.get('goal');
  const rawAssurance = formData.get('assuranceLevel');
  const goal = typeof rawGoal === 'string' ? rawGoal.trim() : '';
  const assuranceLevel = isAssuranceLevel(rawAssurance) ? rawAssurance : 'AL3';
  if (goal.length < 10 || goal.length > 2000) return { plan: null, error: 'Goal muss zwischen 10 und 2000 Zeichen enthalten.' };

  try {
    const client = await createAuthenticatedVitoApiClient();
    const plan = await client.post('/goal-plans/engineering', { goal, assuranceLevel }, parseGoalPlan);
    return { plan, error: null };
  } catch (error) {
    return { plan: null, error: error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR' };
  }
}

function isAssuranceLevel(value: FormDataEntryValue | null): value is AssuranceLevel {
  return value === 'AL1' || value === 'AL2' || value === 'AL3' || value === 'AL4';
}
