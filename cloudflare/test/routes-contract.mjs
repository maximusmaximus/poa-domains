// Real workerd and Node HTTP servers, identical public fixture state and signed bytes.
// No upstream requests; the only private key is a disposable fixture kept in memory.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {generateKeyPairSync} from 'node:crypto';
import {fixtureConfig} from '../../dist/src/config.js';
import {publicPrincipal,signBody,intentId} from '../../dist/src/auth.js';
import {capabilities,prepare,buildMetadataWitness} from '../../dist/src/interface.js';
import {startReferenceServer} from '../../dist/src/reference-server.js';
import {contractEngine,CONTRACT_OPTIONS,CONTRACT_TIME} from '../../dist/test/fixtures/contract-engine.js';
import {REGISTRY_ROUTES} from '../../dist/src/registry-routes.js';

const key=generateKeyPairSync('ed25519').privateKey,issuer=publicPrincipal(key);
const config=fixtureConfig(issuer,'ed25519:'+'3'.repeat(64),[]),engine=contractEngine(config);
const node=await startReferenceServer(engine,0,{host:'127.0.0.1',routes:CONTRACT_OPTIONS});
const scratch=mkdtempSync(join(tmpdir(),'poa-routes-contract-')),port=Number(process.env.CF_CONTRACT_PORT??18895),base=`http://127.0.0.1:${port}`;
const logPath=join(scratch,'workerd.log'),log=openSync(logPath,'w',0o600);
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','cloudflare/test/contract.wrangler.jsonc','--local','--local-upstream','poadomains.grok.me','--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--persist-to',join(scratch,'state'),'--var',`CONTRACT_CONFIG:${JSON.stringify(config)}`],{cwd:resolve(import.meta.dirname,'../..'),env:{...process.env,WRANGLER_SEND_METRICS:'false'},detached:true,stdio:['ignore',log,log]});
closeSync(log);
const observed=new Set();let count=0;
async function compare(path,init={}) {
  const replies=await Promise.all([node.url,base].map(async origin=>{
    const r=await fetch(origin+path,{...init,headers:{'x-request-id':`contract-${count}`,...init.headers},redirect:'manual',signal:AbortSignal.timeout(8000)});
    const text=await r.text();return {status:r.status,body:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text};
  }));
  assert.deepEqual(replies[0],replies[1],`${init.method??'GET'} ${path}`);
  const route=REGISTRY_ROUTES.find(([method,template])=>method===(init.method??'GET')&&(template.includes(':id')?path.startsWith('/v1/receipts/'):template===path.split('?')[0]));
  if(route)observed.add(route.join(' '));count++;return replies[0];
}
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++) {
    if(child.exitCode!==null)throw Error(`Local contract workerd exited; inspect ${logPath}`);
    try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)});if(r.status===200){ready=true;break;}}catch{}
    await delay(100);
  }
  assert.ok(ready,`Local contract workerd readiness failed; inspect ${logPath}`);
  for(const path of ['/healthz','/v1/capabilities','/v1/state','/v1/resolve?name=routecheck','/v1/nonce?signer='+issuer,'/v1/receipts/'+'0'.repeat(64),'/v1/unknown'])await compare(path);
  for(const path of ['/d/routecheck','/p/'+issuer,'/ui-cart.js','/ui-poll.js'])await compare(path);
  await compare('/v1/intents',post('{'));
  await compare('/v1/intents',{...post('{}'),headers:{'content-type':'text/plain'}});
  await compare('/v1/intents',{...post('{}'),headers:{'content-type':'application/json',origin:'https://poadomains.grok.me'}});
  await compare('/v1/intents',{...post('{}'),headers:{'content-type':'application/json','sec-fetch-site':'same-origin'}});
  await compare('/v1/intents?unexpected=1',post('{}'));
  await compare('/v1/intents',post('x'.repeat(65537)));
  for(const method of ['POST','PUT','DELETE'])await compare('/v1/state',{method});
  const body=prepare({signer:issuer,coSigners:[],requestId:'route-contract-announce',nonce:0,notBefore:CONTRACT_TIME,deadline:CONTRACT_TIME+300000,maxTotal:'100',maxNetworkFee:'0',action:'announceAuction',params:{name:'routecheck',asset:'POA',reserve:'100',openAt:CONTRACT_TIME+86400,expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness('routecheck')}},capabilities(engine));
  const packet=signBody(body,[key]);
  const invalid=structuredClone(packet);invalid.signatures[issuer]='00'.repeat(64);
  await compare('/v1/intents',post(invalid));
  const accepted=await compare('/v1/intents',post(packet));assert.equal(accepted.body.status,'succeeded');
  await compare('/v1/intents',post(packet)); // exact resend, idempotent receipt
  for(const path of ['/v1/state','/v1/nonce?signer='+issuer,'/v1/receipts/'+intentId(body),'/v1/resolve?name=routecheck'])await compare(path);
  assert.equal(observed.size,REGISTRY_ROUTES.length);
  console.log(`PASS Node ↔ real workerd: ${count} equal HTTP status/body contracts; all ${REGISTRY_ROUTES.length} shared routes, signed admission, resend, bounds, browser rejection, custom-host deep links and split modules`);
} finally {
  await node.close();
  if(child.exitCode===null) {
    const exited=once(child,'exit');process.kill(-child.pid,'SIGTERM');let timer;
    try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Local contract workerd shutdown timeout')),10000);})]);}
    catch(error){try{process.kill(-child.pid,'SIGKILL');}catch{}throw error;}finally{clearTimeout(timer);}
  }
}
