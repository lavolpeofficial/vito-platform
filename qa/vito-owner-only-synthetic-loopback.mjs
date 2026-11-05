import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..'), app=join(root,'apps/control-center');
const build=readFileSync(join(app,'.next/BUILD_ID'),'utf8').trim();
const apiPort=33878, uiPort=33977, tokenKey=randomBytes(32);
const org='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', otherOrg='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const entries=[
 ['owner','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',org,'OWNER'],
 ['second','cccccccc-cccc-4ccc-8ccc-cccccccccccc',org,'OWNER'],
 ['admin','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',org,'ADMIN'],
 ['foreign','ffffffff-ffff-4fff-8fff-ffffffffffff',otherOrg,'OWNER'],
];
const users=Object.fromEntries(entries.map(([label,id,organizationId,role])=>[label,{id,organizationId,role,email:label+'@synthetic.invalid',firstName:'Synthetic',lastName:label}]));
const byId=Object.fromEntries(Object.values(users).map(x=>[x.id,x]));
const revoked=new Set();
const orgById=Object.fromEntries([[org,{id:org,name:'Synthetic VITO',slug:'la-volpe',status:'ACTIVE'}],[otherOrg,{id:otherOrg,name:'Other Synthetic',slug:'other-org',status:'ACTIVE'}]]);
const sig=(raw)=>createHmac('sha256',tokenKey).update(raw).digest('base64url');
function tokenFor(user){
 const prefix=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:user.id,org_id:user.organizationId})).toString('base64url')].join('.');
 return prefix+'.'+sig(prefix);
}
function verify(token){
 if(!token) return null;
 const a=token.split('.');
 if(a.length!==3) return null;
 const good=Buffer.from(sig(a[0]+'.'+a[1]));
 const got=Buffer.from(a[2]);
 if(got.length!==good.length||!timingSafeEqual(got,good)) return null;
 try{const p=JSON.parse(Buffer.from(a[1],'base64url').toString('utf8'));const user=byId[p.sub];return user&&user.organizationId===p.org_id&&!revoked.has(user.id)?user:null}catch{return null}
}
function send(res,status,obj){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj))}
const mock=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+apiPort);
 if(req.method==='POST'&&url.pathname==='/auth/login'){
  let body='';for await(const chunk of req)body+=chunk;
  let x;try{x=JSON.parse(body)}catch{return send(res,400,{message:'Malformed'})}
  const user=Object.values(users).find(u=>u.email===x.email);
  if(!user||x.password!=='synthetic-qa-only'||orgById[user.organizationId]?.slug!==x.organizationSlug)return send(res,401,{message:'Invalid'});
  return send(res,200,{accessToken:tokenFor(user),tokenType:'Bearer',expiresIn:'15m',user});
 }
 const user=verify((req.headers.authorization||'').replace(/^Bearer /,''));
 if(!user)return send(res,401,{message:'Invalid'});
 if(req.method==='GET'&&url.pathname==='/users/'+user.id)return send(res,200,user);
 if(req.method==='GET'&&url.pathname==='/organizations/'+user.organizationId)return send(res,200,orgById[user.organizationId]);
 return send(res,404,{message:'Missing synthetic route'});
});
const pass=[];
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
function check(condition,label){if(!condition)throw Error('FAILED_CHECK:'+label);pass.push(label)}
async function call(path,options={}){
 return fetch('http://127.0.0.1:'+uiPort+path,{redirect:'manual',signal:AbortSignal.timeout(8000),...options});
}
async function login(label,origin){
 const user=users[label];
 return call('/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:origin||'http://127.0.0.1:'+uiPort},body:JSON.stringify({email:user.email,password:'synthetic-qa-only',organizationSlug:orgById[user.organizationId].slug})});
}
await new Promise((ok,err)=>mock.once('error',err).listen(apiPort,'127.0.0.1',ok));
const child=spawn(process.execPath,[join(app,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(uiPort)],{
 cwd:app,stdio:'ignore',env:{...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',VITO_API_BASE_URL:'http://127.0.0.1:'+apiPort,VITO_CONTROL_OWNER_USER_ID:users.owner.id,VITO_CONTROL_OWNER_ORGANIZATION_ID:org,VITO_CONTROL_CENTER_PUBLIC_ORIGIN:'http://127.0.0.1:'+uiPort}
});
try{
 let up=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('NEXT_EXITED_EARLY');try{const r=await call('/login');if(r.status===200){up=true;break}}catch{}await delay(180)}
 check(up,'local_next_started');
 check((await call('/')).status===307,'anonymous_dashboard_redirect');
 check((await call('/api/auth/session')).status===401,'anonymous_session_denied');
 for(const name of ['owner','second','admin','foreign']){
  const r=await login(name), c=r.headers.get('set-cookie')||'';
  if(name==='owner'){
    check(r.status===200,'exact_owner_login_ok');
    check(c.includes('__Host-vito_session='),'owner_cookie_host_only');
    check(/httponly/i.test(c)&&/secure/i.test(c)&&/samesite=strict/i.test(c),'cookie_security_attributes');
    check(!/domain=/i.test(c),'no_shared_domain_cookie');
    const cookie=c.split(';')[0];
    const sess=await call('/api/auth/session',{headers:{cookie}});
    check(sess.status===200,'owner_session_resolved');
    check((await sess.json()).session?.user?.id===users.owner.id,'owner_session_identity');
  }else{
    check(r.status===401,name+'_login_denied');
    check(!c.includes('__Host-vito_session='),name+'_no_session_cookie');
    const fakeCookie='__Host-vito_session='+tokenFor(users[name]);
    check((await call('/api/auth/session',{headers:{cookie:fakeCookie}})).status===401,name+'_direct_cookie_denied');
    check((await call('/api/executive/work-orders',{headers:{cookie:fakeCookie}})).status===401,name+'_business_api_denied');
  }
 }
 check((await login('owner','https://attacker.invalid')).status===403,'csrf_origin_denied');
 const forged='__Host-vito_session='+tokenFor(users.owner)+'tampered';
 check((await call('/api/auth/session',{headers:{cookie:forged}})).status===401,'bad_signature_denied');
 revoked.add(users.owner.id);
 check((await call('/api/auth/session',{headers:{cookie:'__Host-vito_session='+tokenFor(users.owner)}})).status===401,'revoked_owner_denied');
 check((await call('/api/bob/status',{headers:{'x-organization-id':org}})).status===401,'no_unsigned_tenant_header');
 const report={status:'PASS',scope:'SYNTHETIC_LOCAL_LOOPBACK_ONLY',buildId:build,checksPassed:pass.length,checks:pass,realIdentityUsed:false,liveDbUsed:false,publicNetworkUsed:false,productionMutated:false};
 mkdirSync(join(root,'.local-qa'),{recursive:true});
 writeFileSync(join(root,'.local-qa/R378_OWNER_LOGIN_LOOPBACK_E2E_RESULT.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log('R378_SYNTHETIC_LOGIN_E2E='+report.status+' CHECKS='+report.checksPassed+' BUILD_ID='+build);
 console.log('CHECKS='+pass.join(','));
}catch(error){console.error('R378_SYNTHETIC_LOGIN_E2E=FAIL '+error.message);process.exitCode=1}
finally{
 child.kill('SIGTERM');
 await new Promise(ok=>{if(child.exitCode!==null)return ok();child.once('exit',ok);setTimeout(()=>{child.kill('SIGKILL');ok()},1500).unref()});
 mock.closeAllConnections();
 await new Promise(ok=>mock.close(ok));
}

[executed on device: ubuntu-4gb-hel1-1 (fe3754ea-5627-4a36-b351-e958ef584b11)]