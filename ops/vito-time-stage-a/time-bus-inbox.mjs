/**
 * VITO x URTALI TIME · A2 private CONTROL BUS inbox contract.
 * Pure planner: no DB access, no AI execution, no acknowledgment, no dispatch.
 * It must only consume rows fetched by a trusted server with recipient='time'
 * and a separately authenticated, tenant-bound authorization decision.
 */
const ID=/^[1-9][0-9]{0,18}$/;
const TOPICS=new Set(['task','handoff','blocker','report','notice','document']);
const STATES=new Set(['CLAIMED','IN_PROGRESS','COMPLETED','BLOCKED','FAILED','REVIEW_REQUIRED']);
const ACTIONABLE=new Set(['task','handoff']);
function fail(code){throw Error('TIME_BUS_'+code)}
function idString(v){
  if(typeof v!=='string'||!ID.test(v))fail('MESSAGE_ID_INVALID');
  // Keep bigint IDs as canonical decimal strings: no JS Number coercion.
  return v;
}
function checkedTimestamp(v){
  if(typeof v!=='string'||v.length>40||!(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/).test(v)||!Number.isFinite(Date.parse(v)))fail('TIMESTAMP_INVALID');
  return new Date(v).toISOString();
}
function validateEnvelope(m){
  if(!m||typeof m!=='object'||Array.isArray(m)||m.recipient!=='time'||m.sender!=='vito'||!TOPICS.has(m.topic))fail('ENVELOPE_INVALID');
  const id=idString(m.id);
  if(typeof m.subject!=='string'||m.subject.length<1||m.subject.length>160||/[\x00-\x1f\x7f]/.test(m.subject))fail('SUBJECT_INVALID');
  return {id,sender:'vito',recipient:'time',topic:m.topic,subject:m.subject,receivedAt:checkedTimestamp(m.createdAt)};
}
/**
 * authorizedIds MUST come from server-side verified VITO authorization,
 * not from message details/sender/header. No automatic handling of 'all'.
 * processedEntries represent durable authoritative claims/results.
 */
export function planTimeBusInbox({rows,authorizedIds,processedEntries=[],limit=100}){
  if(!Array.isArray(rows)||rows.length>500||!Array.isArray(authorizedIds)||authorizedIds.length>500||!Array.isArray(processedEntries)||processedEntries.length>10000||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INPUT_LIMIT');
  const permitted=new Set(authorizedIds.map(idString));
  const ledger=new Map();
  for(const e of processedEntries){
    if(!e||typeof e!=='object'||Array.isArray(e))fail('LEDGER_INVALID');
    const id=idString(e.messageId);
    if(!STATES.has(e.state)||ledger.has(id))fail('LEDGER_INVALID');
    ledger.set(id,e.state);
  }
  const seen=new Set(),pending=[],skipped=[];
  for(const raw of rows){
    const m=validateEnvelope(raw);
    if(seen.has(m.id))fail('DUPLICATE_SOURCE_ID');
    seen.add(m.id);
    if(!permitted.has(m.id)){skipped.push({id:m.id,reason:'NOT_AUTHORIZED'});continue}
    if(!ACTIONABLE.has(m.topic)){skipped.push({id:m.id,reason:'NON_ACTIONABLE'});continue}
    if(ledger.has(m.id)){skipped.push({id:m.id,reason:'ALREADY_RECORDED',state:ledger.get(m.id)});continue}
    pending.push(Object.freeze({...m,authority:'AUTHORIZED_CANDIDATE',executionStarted:false}));
  }
  pending.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
  return Object.freeze({mode:'PLAN_ONLY',autoProcessingEnabled:false,requiresAtomicClaim:true,pending:Object.freeze(pending.slice(0,limit)),skipped:Object.freeze(skipped),overflow:Math.max(0,pending.length-limit)});
}
export function validateTimeResult({messageId,claimState,decision,proofRef}){
  const id=idString(messageId);
  if(!STATES.has(claimState)||claimState==='COMPLETED'&&decision!=='RESULT_EVIDENCE_VERIFIED')fail('RESULT_INVALID');
  if(typeof proofRef!=='string'||proofRef.length<8||proofRef.length>160||/[\x00-\x1f\x7f]/.test(proofRef))fail('PROOF_REF_INVALID');
  return Object.freeze({messageId:id,recipient:'vito',sender:'time',topic:'report',claimState,decision,proofRef,sendAuthorized:false});
}
