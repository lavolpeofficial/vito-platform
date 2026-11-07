/**
 * Bounded, UNSIGNED specialist reports. A CONTROL BUS sender label is never
 * identity, workflow execution proof or Owner publication authority.
 */
export type SpecialistReportRow = Readonly<{
  report_id: bigint | string;
  specialist: string;
  subject: string;
  reported_status: string | null;
  reported_at: Date | string;
}>;

export type SpecialistReport = Readonly<{
  reportId: string;
  specialist: 'adoren'|'emporio'|'urtali'|'bridge'|'selecta'|'lavolpe'|'bob'|'riccardo';
  subject: string;
  reportedStatus: string | null;
  reportedAt: string;
  authenticatedAgentReport: false;
  executionVerified: false;
  ownerReleaseApproved: false;
}>;

const SENDERS = new Set<SpecialistReport['specialist']>([
  'adoren','emporio','urtali','bridge','selecta','lavolpe','bob','riccardo',
]);

export function normalizeOwnerSpecialistReports(value: unknown): readonly SpecialistReport[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('REPORT_ROWS_OUT_OF_BOUNDS');
  const result: SpecialistReport[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('REPORT_ROW_INVALID');
    const row = item as Partial<SpecialistReportRow>;
    const id = typeof row.report_id === 'bigint' || typeof row.report_id === 'string'
      ? String(row.report_id) : '';
    const date = row.reported_at instanceof Date
      ? row.reported_at : typeof row.reported_at === 'string'
        ? new Date(row.reported_at) : new Date(NaN);
    const status = row.reported_status;
    if (!/^[1-9][0-9]{0,18}$/.test(id) || seen.has(id) ||
        !SENDERS.has(row.specialist as SpecialistReport['specialist']) ||
        typeof row.subject !== 'string' || !row.subject.length || row.subject.length > 160 ||
        !Number.isFinite(date.getTime()) ||
        (status !== null && (typeof status !== 'string' || !/^[A-Z0-9_:-]{1,80}$/.test(status)))) {
      throw new Error('REPORT_ROW_INVALID');
    }
    seen.add(id);
    result.push({
      reportId: id,
      specialist: row.specialist as SpecialistReport['specialist'],
      subject: row.subject,
      reportedStatus: status,
      reportedAt: date.toISOString(),
      authenticatedAgentReport: false,
      executionVerified: false,
      ownerReleaseApproved: false,
    });
  }
  return result;
}
