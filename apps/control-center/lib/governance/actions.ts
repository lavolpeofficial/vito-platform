'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { parseSkillPromotionReview } from './contracts';

const GOVERNANCE_PATH = '/governance';

export async function reviewSkillPromotion(formData: FormData): Promise<void> {
  const reviewId = field(formData, 'reviewId');
  const decision = field(formData, 'decision');
  const rationale = field(formData, 'rationale', 2000);
  if (!reviewId || !decision || !rationale) redirectGovernance('INVALID_REQUEST');
  if (decision !== 'APPROVE_REGISTRATION' && decision !== 'REJECT') redirectGovernance('INVALID_DECISION');

  const path = decision === 'APPROVE_REGISTRATION'
    ? `/skill-promotion/reviews/${encodeURIComponent(reviewId)}/approve-registration` as const
    : `/skill-promotion/reviews/${encodeURIComponent(reviewId)}/reject` as const;

  try {
    const client = await createAuthenticatedVitoApiClient();
    await client.post(path, { rationale }, parseSkillPromotionReview);
    revalidatePath(GOVERNANCE_PATH);
    redirectGovernance(decision === 'APPROVE_REGISTRATION' ? 'APPROVED_FOR_REGISTRATION' : 'REJECTED', false);
  } catch (error) {
    redirectGovernance(error instanceof VitoApiError ? error.code : 'UNEXPECTED_ERROR');
  }
}

function field(formData: FormData, key: string, max = 512): string | null {
  const value = formData.get(key);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function redirectGovernance(value: string, error = true): never {
  const params = new URLSearchParams();
  params.set(error ? 'error' : 'notice', value);
  redirect(`${GOVERNANCE_PATH}?${params.toString()}` as Parameters<typeof redirect>[0]);
}
