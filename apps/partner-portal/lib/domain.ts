export type AuthorizationLevel = 'NONE' | 'REFERRAL_ONLY' | 'SALES_ALLOWED' | 'ADVISORY_ALLOWED' | 'RESELLER_ALLOWED';
export type PortfolioPermission = 'NONE' | 'REFERRAL_ONLY' | 'SALES_ALLOWED' | 'ADVISORY_ALLOWED';

const rank: Record<string, number> = {
  NONE: 0,
  REFERRAL_ONLY: 1,
  SALES_ALLOWED: 2,
  ADVISORY_ALLOWED: 3,
  RESELLER_ALLOWED: 4,
};

export function canUseOffer(authorization: AuthorizationLevel, portfolioPermission: PortfolioPermission, required: PortfolioPermission): boolean {
  return rank[authorization] >= rank[required] && rank[portfolioPermission] >= rank[required];
}

export function eligibleCnr(input: { collected: number; passThrough?: number; refunds?: number }): number {
  const value = input.collected - (input.passThrough ?? 0) - (input.refunds ?? 0);
  return Math.max(0, Math.round(value * 100) / 100);
}

export function commissionAmount(cnr: number, ratePercent: number): number {
  if (cnr < 0 || ratePercent < 0) throw new Error('NEGATIVE_FINANCE_INPUT');
  return Math.round(cnr * (ratePercent / 100) * 100) / 100;
}

export function leadProtectionDays(extensionApproved: boolean): number {
  return extensionApproved ? 180 : 90;
}

export function nextAuthorization(progress: number): AuthorizationLevel {
  if (progress >= 100) return 'ADVISORY_ALLOWED';
  if (progress >= 70) return 'SALES_ALLOWED';
  if (progress > 0) return 'REFERRAL_ONLY';
  return 'NONE';
}
