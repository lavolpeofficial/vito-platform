import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const app=join(root,'apps/control-center');
const uiPort=33980, apiPort=33880;
const organizationId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const adminId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const makeUser=(id,role)=>({id,organizationId,email:role.toLowerCase()+'@synthetic.invalid',firstName:'Test',lastName:role,role});
const users=[makeUser(ownerId,'OWNER'),makeUser(adminId,'ADMIN')];
const org={id:organizationId,name:'Synthetic',slug:'synthetic',status:'ACTIVE'};
const tokens=new Map();
const results=[];
function send(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
const api=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:'+apiPort);
 if(req.method==='POST'&&url.pathname==='/auth/login'){
  let body='';for await(const chunk of req)body+=chunk;
  let x;try{x=JSON.parse(body)}catch{return send(res,400,{message:'Invalid'})}
  const user=users.find(u=>u.email===x.email);
  if(!user||x.password!=='synthetic-only'||x.organizationSlug!==org.slug)return send(res,401,{message:'Invalid'});
  const prefix='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:user.id,org_id:organizationId})).toString('base64url');
  const token=prefix+'.YWJjZGVm';
  tokens.set(token,user);
  return send(res,200,{accessToken:token,tokenType:'Bearer',expiresIn:'15m',user});
 }
 const user=tokens.get((req.headers.authorization||'').replace(/^Bearer /,''));
 if(!user)return send(res,401,{message:'Denied'});
 if(req.method==='GET'&&url.pathname==='/organizations/'+organizationId)return send(res,200,org);
 if(req.method==='GET'&&url.pathname==='/users/'+user.id)return send(res,200,user);
 return send(res,404,{message:'Missing'});
});
function check(ok,name){if(!ok)throw Error('FAIL:'+name);results.push(name)}
async function runMode(label,setting,pins,ownerExpected,adminExpected){
 const env={...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',VITO_API_BASE_URL:'http://127.0.0.1:'+apiPort,VITO_CONTROL_CENTER_PUBLIC_ORIGIN:'http://127.0.0.1:'+uiPort};
 delete env.VITO_CONTROL_OWNER_ONLY;delete env.VITO_CONTROL_OWNER_USER_ID;delete env.VITO_CONTROL_OWNER_ORGANIZATION_ID;
 if(setting!==null)env.VITO_CONTROL_OWNER_ONLY=setting;
 if(pins){env.VITO_CONTROL_OWNER_USER_ID=ownerId;env.VITO_CONTROL_OWNER_ORGANIZATION_ID=organizationId}
 const child=spawn(process.execPath,[join(app,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(uiPort)],{cwd:app,env,stdio:'ignore'});
 try{
  let up=false;for(let i=0;i<60;i++){
   if(child.exitCode!==null)throw Error(label+':SERVER_EXIT');
   try{const r=await fetch('http://127.0.0.1:'+uiPort+'/login',{signal:AbortSignal.timeout(1200)});if(r.status===200){up=true;break}}catch{}
   await new Promise(r=>setTimeout(r,180));
  }
  check(up,label+':server');
  for(const user of users){
   const expected=user.role==='OWNER'?ownerExpected:adminExpected;
   const r=await fetch('http://127.0.0.1:'+uiPort+'/api/auth/login',{method:'POST',redirect:'manual',headers:{'content-type':'application/json',origin:'http://127.0.0.1:'+uiPort},body:JSON.stringify({email:user.email,password:'synthetic-only',organizationSlug:org.slug}),signal:AbortSignal.timeout(9000)});
   check(r.status===expected,label+':'+user.role+':http_'+expected);
   const cookie=(r.headers.get('set-cookie')||'').split(';')[0];
   if(expected===200){
    check(cookie.startsWith('__Host-vito_session='),label+':'+user.role+':cookie');
    const session=await fetch('http://127.0.0.1:'+uiPort+'/api/auth/session',{headers:{cookie},signal:AbortSignal.timeout(9000)});
    check(session.status===200,label+':'+user.role+':session');
   }else check(!cookie.startsWith('__Host-vito_session='),label+':'+user.role+':cookie_denied');
  }
 }finally{
  child.kill('SIGTERM');
  await new Promise(ok=>{if(child.exitCode!==null)return ok();child.once('exit',ok);setTimeout(()=>{child.kill('SIGKILL');ok()},1200).unref()});
 }
}
await new Promise((ok,err)=>api.once('error',err).listen(apiPort,'127.0.0.1',ok));
try{
 await runMode('flag_absent',null,false,200,200);
 await runMode('flag_false','false',false,200,200);
 await runMode('flag_true_unpinned','true',false,401,401);
 await runMode('flag_true_pinned','true',true,200,401);
 console.log('VITO_OWNER_ACTIVATION_SWITCH_SMOKE=PASS CHECKS='+results.length+' BUILD_ID='+readFileSync(join(app,'.next/BUILD_ID'),'utf8').trim());
 console.log('SCENARIOS='+['flag_absent','flag_false','flag_true_unpinned','flag_true_pinned'].join(','));
}catch(error){console.error('VITO_OWNER_ACTIVATION_SWITCH_SMOKE=FAIL '+error.message);process.exitCode=1}
finally{api.closeAllConnections();await new Promise(ok=>api.close(ok))}
