import './governance.css';
import { createAuthenticatedVitoApiClient } from '@/lib/api/server';
import { VitoApiError } from '@/lib/api/error';
import { reviewSkillPromotion } from '@/lib/governance/actions';
import { parseSkillPromotionReviews, type SkillPromotionReview } from '@/lib/governance/contracts';

export const metadata = { title: 'Governance & Reviews' };
type SearchParams = Promise<Readonly<Record<string, string | string[] | undefined>>>;

const NOTICE_COPY: Readonly<Record<string, string>> = {
  APPROVED_FOR_REGISTRATION: 'Review freigegeben – ausschließlich für Capability-Registrierungsprüfung. Keine Execution Authority wurde erteilt.',
  REJECTED: 'Review wurde abgelehnt.',
};

export default async function GovernancePage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const params = await searchParams;
  const status = first(params.status);
  const notice = first(params.notice);
  const error = first(params.error);
  const allowedStatus = status === 'PENDING_REVIEW' || status === 'APPROVED_FOR_REGISTRATION' || status === 'REJECTED' ? status : undefined;

  let reviews: readonly SkillPromotionReview[] = [];
  let loadError: string | null = null;
  try {
    const client = await createAuthenticatedVitoApiClient();
    const query = new URLSearchParams({ limit: '100' });
    if (allowedStatus) query.set('status', allowedStatus);
    reviews = await client.get(`/skill-promotion/reviews?${query.toString()}` as `/${string}`, parseSkillPromotionReviews);
  } catch (caught) {
    loadError = caught instanceof VitoApiError ? caught.code : 'UNEXPECTED_ERROR';
  }

  const pending = reviews.filter((review) => review.status === 'PENDING_REVIEW').length;
  const approved = reviews.filter((review) => review.status === 'APPROVED_FOR_REGISTRATION').length;
  const rejected = reviews.filter((review) => review.status === 'REJECTED').length;

  return <main>
    <div className="breadcrumb"><a href="/">Control Center</a><span>/</span><span>Governance & Reviews</span></div>
    <section className="module-heading"><div className="module-icon">GV</div><div><span className="eyebrow">Human authority</span><h1>Governance & Reviews</h1><p>Skill-Promotion-Entscheidungen sichtbar machen und nur die bestehenden human-governed Übergänge auslösen.</p></div></section>
    <div className="boundary-notice"><span className="system-dot" /><div><strong>Approval ist keine Aktivierung</strong><p>APPROVED_FOR_REGISTRATION bedeutet nur: Capability-Registrierung darf geprüft werden. Es werden weder Capability, Provider-Binding noch Execution Authority automatisch erzeugt.</p></div></div>
    {notice && NOTICE_COPY[notice] ? <div className="gov-banner gov-success">{NOTICE_COPY[notice]}</div> : null}
    {error ? <div className="gov-banner gov-error">Governance-Aktion fehlgeschlagen oder abgelehnt: {error}</div> : null}
    {loadError ? <div className="gov-banner gov-error">Reviews konnten nicht geladen werden: {loadError}</div> : null}

    <section className="gov-metrics"><Metric label="Pending" value={pending} /><Metric label="Approved for registration" value={approved} /><Metric label="Rejected" value={rejected} /></section>

    <section className="gov-panel">
      <div className="gov-head"><div><span className="eyebrow">01 · Review queue</span><h2>Skill Promotion Reviews</h2></div><form method="get"><select name="status" defaultValue={allowedStatus ?? ''}><option value="">Alle</option><option value="PENDING_REVIEW">Pending</option><option value="APPROVED_FOR_REGISTRATION">Approved for registration</option><option value="REJECTED">Rejected</option></select><button type="submit">Filtern</button></form></div>
      {reviews.length === 0 ? <p className="gov-empty">Keine Reviews in dieser Sicht.</p> : <div className="gov-list">{reviews.map((review) => <ReviewCard key={review.id} review={review} />)}</div>}
    </section>
  </main>;
}

function ReviewCard({ review }: Readonly<{ review: SkillPromotionReview }>) {
  const pending = review.status === 'PENDING_REVIEW';
  const evidence = review.evidenceSnapshot;
  return <article className="gov-card">
    <div className="gov-card-top"><div><strong>{review.targetCapabilityCode}</strong><span>{review.skillCandidateId}</span></div><Status value={review.status} /></div>
    <dl className="gov-evidence"><Row label="Candidate code" value={printEvidence(evidence.candidateCode)} /><Row label="Confidence" value={printEvidence(evidence.confidence)} /><Row label="Learning candidate" value={printEvidence(evidence.learningCandidateId)} /><Row label="Requested" value={formatDate(review.createdAt)} /></dl>
    {review.reviewRationale ? <div className="gov-rationale"><strong>Rationale</strong><p>{review.reviewRationale}</p><small>{review.reviewedAt ? formatDate(review.reviewedAt) : ''}</small></div> : null}
    {pending ? <form action={reviewSkillPromotion} className="gov-action-form"><input type="hidden" name="reviewId" value={review.id} /><label>Begründung<textarea name="rationale" minLength={1} maxLength={2000} required placeholder="Warum ist diese Entscheidung angemessen?" /></label><div><button name="decision" value="APPROVE_REGISTRATION" type="submit">Für Registrierungsprüfung freigeben</button><button name="decision" value="REJECT" className="gov-reject" type="submit">Ablehnen</button></div><small>Keine dieser Aktionen aktiviert eine Capability oder einen Provider.</small></form> : null}
  </article>;
}

function Metric({ label, value }: Readonly<{ label: string; value: number }>) { return <article className="gov-metric"><span>{label}</span><strong>{value}</strong></article>; }
function Row({ label, value }: Readonly<{ label: string; value: string }>) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function Status({ value }: Readonly<{ value: string }>) { return <span className={`gov-status gov-status-${value.toLowerCase().replaceAll('_', '-')}`}>{value}</span>; }
function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function formatDate(value: string): string { return new Date(value).toLocaleString('de-DE'); }
function printEvidence(value: unknown): string { if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value); return '—'; }
