/**
 * BRIDGE review queue read model, server-side VITO dashboard only.
 * No fetching, no writes, no invented data. The eventual repository adapter
 * must supply authenticated owner-scoped data through a separate service.
 */
export type BridgeReviewRow=Readonly<{
 requestId:string; partnerRef:string; leadRef:string; action:string;
 status:'pending'|'accepted_for_review'|'rejected'; reviewGate:string;
 expectedVersion:number; submittedAt:string;
}>;
export type BridgeReviewSnapshot=Readonly<{
 source:'bridge-internal-readonly';
 generatedAt:string; count:number; items:readonly BridgeReviewRow[];
}>;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(['lead.qualify_proposal','lead.handoff_proposal','lead.request_close']);
const status=new Set(['pending','accepted_for_review','rejected']);
const gate=new Set(['QUALIFICATION_BEFORE_ACCEPTANCE','BACKOFFICE_REVIEW_REQUIRED']);
const record=(x:unknown):x is Record<string,unknown>=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x);
export function parseBridgeReviewSnapshot(input:unknown):BridgeReviewSnapshot|null{
 if(!record(input)||input.source!=='bridge-internal-readonly'||!Array.isArray(input.items)||
    input.items.length>100||input.count!==input.items.length||
    typeof input.generatedAt!=='string'||!Number.isFinite(Date.parse(input.generatedAt)))return null;
 const ids=new Set<string>();
 const rows:BridgeReviewRow[]=[];
 for(const item of input.items){
  if(!record(item)||typeof item.requestId!=='string'||!UUID.test(item.requestId)||
     typeof item.partnerRef!=='string'||!ID.test(item.partnerRef)||
     typeof item.leadRef!=='string'||!ID.test(item.leadRef)||
     typeof item.action!=='string'||!actions.has(item.action)||
     typeof item.status!=='string'||!status.has(item.status)||
     typeof item.reviewGate!=='string'||!gate.has(item.reviewGate)||
     !Number.isInteger(item.expectedVersion)||item.expectedVersion<1||
     typeof item.submittedAt!=='string'||!Number.isFinite(Date.parse(item.submittedAt))||
     ids.has(item.requestId))return null;
  ids.add(item.requestId);
  rows.push(Object.freeze({
   requestId:item.requestId,partnerRef:item.partnerRef,leadRef:item.leadRef,
   action:item.action,status:item.status as BridgeReviewRow['status'],
   reviewGate:item.reviewGate,expectedVersion:item.expectedVersion,
   submittedAt:item.submittedAt
  }));
 }
 return Object.freeze({source:'bridge-internal-readonly',
  generatedAt:input.generatedAt,count:rows.length,items:Object.freeze(rows)});
}
