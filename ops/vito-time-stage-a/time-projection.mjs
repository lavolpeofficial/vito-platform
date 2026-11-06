/**
 * VITO × URTALI TIME · A1 read-only event projection.
 * Projection only: no database, calendar writes, notification or authorization.
 * Caller must authenticate and tenant-scope all source data.
 */
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const BUS_ID = /^[1-9][0-9]{0,18}$/;
const STATUSES = new Set(['OPEN','IN_PROGRESS','WAITING','COMPLETED','CANCELLED']);
const TOPICS = new Set(['task','handoff','blocker','report','notice','document']);
const SENDERS = new Set(['adoren','emporio','selecta','urtali','lavolpe','bridge','vito','owner','bob','riccardo']);
function iso(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw Error('TIME_TIMESTAMP_INVALID');
  const d=Date.parse(value);
  if(!Number.isFinite(d)) throw Error('TIME_TIMESTAMP_INVALID');
  return new Date(d).toISOString();
}
function title(value) {
  if(typeof value !== 'string' || value.length<1 || value.length>200 || /[\x00-\x1f\x7f]/.test(value)) throw Error('TIME_TITLE_INVALID');
  return value;
}
export function projectTimeAgenda({tasks,bus,organizationId,now}) {
  if (!UUID.test(organizationId)) throw Error('TIME_TENANT_INVALID');
  if (!Array.isArray(tasks) || tasks.length>500 || !Array.isArray(bus) || bus.length>200) throw Error('TIME_INPUT_LIMIT');
  const observedAt=iso(now), events=[],dedupe=new Set(),warnings=[];
  for(const t of tasks) {
    if(!t || typeof t!=='object' || Array.isArray(t) || t.organizationId!==organizationId) throw Error('TIME_TENANT_MISMATCH');
    if(!UUID.test(t.id) || !STATUSES.has(t.status)) throw Error('TIME_TASK_INVALID');
    const id='task:'+t.id;
    if(dedupe.has(id)) throw Error('TIME_DUPLICATE_ID');
    dedupe.add(id);
    const updated=iso(t.updatedAt),created=iso(t.createdAt);
    if(updated<created) throw Error('TIME_EVENT_ORDER_INVALID');
    events.push(Object.freeze({id,kind:'TASK_ACTIVITY',title:title(t.title),at:updated,taskId:t.id,status:t.status,source:'VITO_TASKS',verifiedComplete:false,deadlineAt:null,followupRequired:t.status==='WAITING'}));
    if(t.status==='COMPLETED') warnings.push('COMPLETED_REQUIRES_INDEPENDENT_EVIDENCE:'+t.id);
  }
  for(const b of bus) {
    if(!b || typeof b!=='object' || Array.isArray(b) || typeof b.externalMessageId!=='string' || !BUS_ID.test(b.externalMessageId) || !TOPICS.has(b.topic) || !SENDERS.has(b.senderLabel)) throw Error('TIME_BUS_INVALID');
    const id='bus:'+b.externalMessageId;
    if(dedupe.has(id)) throw Error('TIME_DUPLICATE_ID');
    dedupe.add(id);
    const at=iso(b.observedAt);
    events.push(Object.freeze({id,kind:'INCOMING_MESSAGE',title:b.senderLabel+' · '+b.topic,at,externalMessageId:b.externalMessageId,status:'PENDING_REVIEW',source:'NEON_CONTROL_BUS',verifiedComplete:false,deadlineAt:null,followupRequired:b.topic==='blocker'}));
  }
  events.sort((a,b)=>b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return Object.freeze({authority:'READ_ONLY',executionAuthorized:false,observedAt,events:Object.freeze(events),warnings:Object.freeze(warnings)});
}
