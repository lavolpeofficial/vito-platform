export type VerificationStatus = 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE' | 'BLOCKED';
export type VerificationRecord = Readonly<{ id:string; organizationId:string; workflowRunId:string; workflowStepRunId:string; stepType:string; ruleCode:string; status:VerificationStatus; evidence:Readonly<Record<string,unknown>>; createdAt:string }>;
const statuses = new Set<VerificationStatus>(['VERIFIED','FAILED','INCONCLUSIVE','BLOCKED']);
export function parseVerificationRecords(input: unknown): readonly VerificationRecord[] | null { if(!Array.isArray(input)) return null; const out:VerificationRecord[]=[]; for(const value of input){ if(!isRecord(value)||!text(value.id)||!text(value.organizationId)||!text(value.workflowRunId)||!text(value.workflowStepRunId)||!text(value.stepType)||!text(value.ruleCode)||typeof value.status!=='string'||!statuses.has(value.status as VerificationStatus)||!isRecord(value.evidence)||!date(value.createdAt)) return null; out.push(value as VerificationRecord);} return out; }
function isRecord(v:unknown): v is Record<string,unknown>{ return typeof v==='object'&&v!==null&&!Array.isArray(v); }
function text(v:unknown): v is string { return typeof v==='string'&&v.trim().length>0; }
function date(v:unknown): v is string { return typeof v==='string'&&Number.isFinite(Date.parse(v)); }
