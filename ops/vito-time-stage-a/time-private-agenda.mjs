/** VITO × URTALI TIME · A1 private scheduling and outbox candidate.
 * Pure, no I/O, sends nothing. Must be called AFTER server-authenticated owner/admin
 * access and tenant-bound task reads. CONTROL BUS has no organization_id, so bus
 * rows MUST NOT be admitted without an independently verified tenant mapping.
 */
import { createHash } from 'node:crypto';
import { projectTimeAgenda } from './time-projection.mjs';
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const TS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/;
const ALLOWED_CHANNELS=new Set(['IN_APP']);
const EVIDENCE_STATES=new Set(['RESERVED','DISPATCHING','DELIVERED','FAILED','UNKNOWN']);
function fail(code){throw new Error('TIME_'+code)}
function utc(value){
  if(typeof value!=='string'||value.length>40||!TS.test(value))fail('TIMESTAMP_INVALID');
  const millis=Date.parse(value);if(!Number.isFinite(millis))fail('TIMESTAMP_INVALID');
  return new Date(millis).toISOString();
}
function tenant(value){if(typeof value!=='string'||!UUID.test(value))fail('TENANT_INVALID')}
function verifyEventId(id){if(typeof id!=='string'||!(/^(?:task:[0-9a-f-]{36}|bus:[1-9][0-9]{0,18})$/i.test(id)))fail('EVENT_REF_INVALID')}
function digest(parts){return createHash('sha256').update(parts.join('\x1f')).digest('hex')}

/**
 * Caller supplies only VITO-authorized snapshots, never user-provided org headers.
 * busVerified=false by default: fail closed rather than read unscopeable BUS rows.
 * busVerified=true is not itself a security check; only a trusted server adapter
 * holding independently validated org+message provenance may use it.
 */
export function buildPrivateAgenda({organizationId,now,tasks=[],bus=[],busVerified=false,followups=[]}) {
  tenant(organizationId);
  if(!Array.isArray(bus)|| (bus.length && busVerified!==true))fail('BUS_SCOPE_UNVERIFIED');
  if(!Array.isArray(followups)||followups.length>500)fail('FOLLOWUP_INPUT_LIMIT');
  const activity=projectTimeAgenda({organizationId,now,tasks,bus});
  const byId=new Map(activity.events.map(e=>[e.id,e]));
  const schedule=[];const seen=new Set();
  for(const event of activity.events){
    if(event.kind!=='TASK_ACTIVITY'||!event.deadlineAt||['COMPLETED','CANCELLED'].includes(event.status))continue;
    const id='deadline:'+event.id;
    seen.add(id);
    schedule.push(Object.freeze({id,eventId:event.id,kind:'DEADLINE',at:event.deadlineAt,source:'VITO_TASKS_DUE_AT'}));
  }
  for(const item of followups){
    if(!item||typeof item!=='object'||Array.isArray(item)||item.organizationId!==organizationId)fail('FOLLOWUP_TENANT_MISMATCH');
    verifyEventId(item.eventId);
    const event=byId.get(item.eventId);
    if(!event)fail('FOLLOWUP_UNKNOWN_EVENT');
    if(event.status==='COMPLETED'||event.status==='CANCELLED')fail('FOLLOWUP_CLOSED_EVENT');
    if(item.source!=='OWNER_APPROVED_TIME_RECORD'||!UUID.test(item.recordId))fail('FOLLOWUP_AUTHORITY_INVALID');
    const at=utc(item.followupAt);
    const id='followup:'+item.recordId;
    if(seen.has(id))fail('FOLLOWUP_DUPLICATE_ID');
    seen.add(id);
    schedule.push(Object.freeze({id,eventId:item.eventId,kind:'FOLLOWUP',at,source:item.source}));
  }
  schedule.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  return Object.freeze({organizationId,authority:'READ_ONLY',observedAt:activity.observedAt,events:activity.events,schedule:Object.freeze(schedule),warnings:activity.warnings,notificationSendingEnabled:false});
}

/**
 * Deterministically plan notification intents without dispatching. Durable uniqueness
 * and all delivery evidence must be implemented by a transactional server outbox.
 * Existing evidence with ANY state prevents blindly repeating a possible delivery.
 */
export function planNotificationOutbox({agenda,organizationId,now,leadMinutes=[60,0],catchupMinutes=60,existingEvidence=[]}) {
  tenant(organizationId);
  if(!agenda||agenda.authority!=='READ_ONLY'||agenda.organizationId!==organizationId||!Array.isArray(agenda.schedule))fail('OUTBOX_AGENDA_INVALID');
  const clock=Date.parse(utc(now));
  if(!Array.isArray(leadMinutes)||leadMinutes.length>10||leadMinutes.some(v=>!Number.isSafeInteger(v)||v<0||v>10080)||new Set(leadMinutes).size!==leadMinutes.length)fail('OUTBOX_POLICY_INVALID');
  if(!Number.isSafeInteger(catchupMinutes)||catchupMinutes<0||catchupMinutes>1440)fail('OUTBOX_POLICY_INVALID');
  if(!Array.isArray(existingEvidence)||existingEvidence.length>5000)fail('OUTBOX_EVIDENCE_INVALID');
  const stored=new Set();const evidenceByKey=new Map();
  for(const e of existingEvidence){
    if(!e||typeof e!=='object'||e.organizationId!==organizationId||typeof e.intentKey!=='string'||!/^[0-9a-f]{64}$/.test(e.intentKey)||!EVIDENCE_STATES.has(e.state)||stored.has(e.intentKey))fail('OUTBOX_EVIDENCE_INVALID');
    if(e.state==='DELIVERED'&&!(typeof e.deliveryReceiptId==='string'&&/^[A-Za-z0-9:_-]{8,128}$/.test(e.deliveryReceiptId)))fail('OUTBOX_DELIVERY_PROOF_MISSING');
    stored.add(e.intentKey);evidenceByKey.set(e.intentKey,e.state);
  }
  const pending=[],suppressed=[];
  for(const slot of agenda.schedule){
    verifyEventId(slot.eventId);
    for(const minutes of leadMinutes){
      const due=Date.parse(utc(slot.at));
      const scheduledAt=due-minutes*60000;
      if(clock<scheduledAt||clock-scheduledAt>catchupMinutes*60000)continue;
      for(const channel of ALLOWED_CHANNELS){
        const intentKey=digest(['TIME_A1',organizationId,slot.id,slot.kind,slot.at,String(minutes),channel]);
        if(stored.has(intentKey)){
          suppressed.push(Object.freeze({intentKey,state:evidenceByKey.get(intentKey)}));continue;
        }
        pending.push(Object.freeze({intentKey,organizationId,eventId:slot.eventId,scheduleId:slot.id,kind:slot.kind,channel,scheduledAt:new Date(scheduledAt).toISOString(),payloadCode:'VITO_TIME_ATTENTION',recipientScope:'OWNER',deliveryState:'NOT_RESERVED'}));
      }
    }
  }
  return Object.freeze({authority:'PLAN_ONLY',sendingEnabled:false,intents:Object.freeze(pending),suppressed:Object.freeze(suppressed),requiresAtomicDurableReservation:true});
}

/** Distinguish provider submission from verified delivery; do not invent success. */
export function classifyDeliveryEvidence(record){
  if(!record||!EVIDENCE_STATES.has(record.state))fail('OUTBOX_EVIDENCE_INVALID');
  if(record.state==='DELIVERED'){
    if(typeof record.deliveryReceiptId!=='string'||!/^[A-Za-z0-9:_-]{8,128}$/.test(record.deliveryReceiptId))fail('OUTBOX_DELIVERY_PROOF_MISSING');
    return 'DELIVERY_REPORTED_REQUIRES_PROVIDER_VERIFICATION';
  }
  return record.state==='UNKNOWN'?'REVIEW_REQUIRED':record.state==='FAILED'?'FAILED_UNCONFIRMED':'NOT_DELIVERED_CONFIRMED';
}
