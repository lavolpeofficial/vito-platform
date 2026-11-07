import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseBridgeReviewSnapshot} from '../lib/bridge-review/contracts.ts';

const item={
 requestId:'11111111-1111-4111-8111-111111111111',partnerRef:'synthetic_partner_A',
 leadRef:'synthetic_lead_01',action:'lead.handoff_proposal',
 status:'pending',reviewGate:'QUALIFICATION_BEFORE_ACCEPTANCE',
 expectedVersion:7,submittedAt:'2026-11-07T12:00:00Z',
 email:'never-render@example.invalid',notes:'NEVER_RENDER'
};
const snapshot={source:'bridge-internal-readonly',generatedAt:'2026-11-07T13:00:00Z',
 count:1,items:[item]};
test('valid bounded review rows sanitize all private/PII fields',()=>{
 const x=parseBridgeReviewSnapshot(snapshot);
 assert.ok(x);assert.equal(x.count,1);
 assert.equal(x.items[0].requestId,item.requestId);
 assert.equal(x.items[0].reviewGate,'QUALIFICATION_BEFORE_ACCEPTANCE');
 assert.ok(!JSON.stringify(x).includes('@'));
 assert.ok(!JSON.stringify(x).includes('NEVER_RENDER'));
 assert.equal(Object.isFrozen(x),true);assert.equal(Object.isFrozen(x.items[0]),true);
});
test('not connected is not an empty, falsely successful inbox',()=>{
 assert.equal(parseBridgeReviewSnapshot(null),null);
 assert.equal(parseBridgeReviewSnapshot({}),null);
});
test('faked data source and count mismatch fail closed',()=>{
 assert.equal(parseBridgeReviewSnapshot({...snapshot,source:'client-data'}),null);
 assert.equal(parseBridgeReviewSnapshot({...snapshot,count:2}),null);
});
test('unsupported status, invalid stage/version, unknown action fail closed',()=>{
 for(const change of [
 {status:'approved'},{expectedVersion:0},{expectedVersion:'7'},
 {reviewGate:'OVERRIDE_ALL'},{action:'commission.approve'},
 {leadRef:'../../private'},{partnerRef:''},{requestId:'bad'},
 {submittedAt:'not-a-date'}
 ])assert.equal(parseBridgeReviewSnapshot({...snapshot,items:[{...item,...change}]}),null);
});
test('duplicate ID and oversized results fail closed',()=>{
 assert.equal(parseBridgeReviewSnapshot({...snapshot,count:2,items:[item,item]}),null);
 const a=Array.from({length:101},(_,i)=>({...item,requestId:
  i.toString(16).padStart(8,'0')+'-1111-4111-8111-111111111111'}));
 assert.equal(parseBridgeReviewSnapshot({...snapshot,count:a.length,items:a}),null);
});
test('no source can directly pass a proposed finalization as approval',()=>{
 const x=parseBridgeReviewSnapshot({...snapshot,items:[{...item,action:'lead.finalize'}]});
 assert.equal(x,null);
});
