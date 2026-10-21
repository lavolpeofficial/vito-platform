import type { AuthorizationLevel, PortfolioPermission } from './domain';

export type PartnerRole = 'SCOUT' | 'SALES_PARTNER' | 'PARTNER_RECRUITER' | 'BUSINESS_PARTNER' | 'PARTNER_ADMIN';
export type PartnerLifecycleStatus =
  | 'APPLY' | 'SCREEN' | 'APPROVE' | 'CONTRACT' | 'VERIFY' | 'TRAIN'
  | 'CERTIFY' | 'AUTHORIZE' | 'ACTIVATE' | 'PRODUCE' | 'REVIEW'
  | 'DEVELOP' | 'SUSPEND' | 'OFFBOARD';

export type LeadStatus =
  | 'SUBMITTED' | 'ACCEPTED' | 'REVIEW_REQUIRED' | 'DUPLICATE'
  | 'EXISTING_CUSTOMER' | 'EXISTING_OPPORTUNITY'
  | 'PROTECTED_BY_OTHER_PARTNER' | 'REJECTED';

export type CommissionStatus =
  | 'CALCULATED' | 'PENDING_PAYMENT' | 'ELIGIBLE' | 'APPROVED' | 'PAID' | 'REVERSED';

export type PartnerAuthorization = Readonly<{
  capability: string;
  offerId: string;
  market: string;
  permission: PortfolioPermission;
  level: AuthorizationLevel;
  maxDiscountPercent: number;
  proposalAuthority: 'VIEW_ONLY' | 'REQUEST_ONLY' | 'PRESENT_ALLOWED' | 'NEGOTIATE_WITHIN_LIMITS' | 'SIGNING_AUTHORITY';
  validFrom: string;
  validUntil: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}>;

export type LeadRegistrationInput = Readonly<{
  companyName: string;
  website?: string;
  country: string;
  city?: string;
  industry?: string;
  contactName?: string;
  contactRole?: string;
  businessEmail?: string;
  contactBasis: 'PUBLIC_BUSINESS_CONTACT' | 'PERSONAL_NETWORK' | 'REFERRAL' | 'INBOUND_REQUEST' | 'EVENT' | 'OTHER';
  knownNeed?: string;
  source: string;
}>;

export type BusinessOrientationSummary = Readonly<{
  orientationId: string;
  companyId: string;
  primaryArea: string;
  secondaryAreas: readonly string[];
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendedPath: string;
  userConfirmed: boolean;
  consentedForPartnerView: boolean;
}>;
