// Local-only human -> copied cart -> HTTP MCP agent. No real funds, keys or escrow.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,openSync,closeSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {generateKeyPairSync} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {nativePrincipal,signBody,intentId} from '../../dist/src/auth.js';
import {mainnetConfig} from '../../dist/src/config.js';
import {prepare,capabilities} from '../../dist/src/interface.js';
import {contractEngine} from '../../dist/test/fixtures/contract-engine.js';
import {hash} from '../../dist/src/core.js';
import {validateAgentCartHandoff} from '../../reference-web/agent-cart.js';
const keys=Array.from({length:3},()=>generateKeyPairSync('ed25519').privateKey);
const [buyer,treasury,rival]=keys.map(nativePrincipal);
const config=mainnetConfig(buyer,treasury,[rival],{instance:'local-agent-journey',genesisHash:hash('local-only-e2e-genesis/v1',[buyer,treasury,rival])});
// Independent expected identity is derived ONLY in the harness, never trusted from HTTP.
const expectedIdentity=capabilities(contractEngine(config));
function pinIdentity(cap){for(const key of ['revision','chainId','genesisHash','registryId','policyHash','normalizationHash'])assert.equal(cap[key],expectedIdentity[key],'LOCAL_FIXTURE_IDENTITY');}
const port=18898,base=`http://127.0.0.1:${port}`,target=base+'/mcp';
function localTarget(url){const u=new URL(url);assert.equal(u.origin,base,'LOOPBACK_ONLY');assert.equal(u.pathname,'/mcp','MCP_ONLY');return u.href;}
assert.throws(()=>localTarget('https://poadomains.grok.me/mcp'),/LOOPBACK_ONLY/);
assert.throws(()=>localTarget(base+'/v1/intents'),/MCP_ONLY/);
const scratch=mkdtempSync(join(tmpdir(),'poa-agent-journey-')),logPath=join(scratch,'workerd.log'),log=openSync(logPath,'w',0o600);
const child=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config','cloudflare/test/agent-journey.wrangler.jsonc','--local','--ip','127.0.0.1','--port',String(port),'--inspector-port','0','--persist-to',join(scratch,'state'),'--var',`CONTRACT_CONFIG:${JSON.stringify(config)}`],{detached:true,stdio:['ignore',log,log],env:{HOME:process.env.HOME,PATH:process.env.PATH,LANG:'C.UTF-8',WRANGLER_SEND_METRICS:'false',...(process.env.NODE_OPTIONS?{NODE_OPTIONS:process.env.NODE_OPTIONS,NODE_V8_COVERAGE:process.env.NODE_V8_COVERAGE}:{})}});closeSync(log);
let counter=0,signatures=0,browser,clientIp="192.0.2.14";const requests=[],errors=[],blocked=[];
async function rpc(method,params={},extra={}){
 const body=JSON.stringify({jsonrpc:'2.0',id:++counter,method,params});
 const response=await fetch(localTarget(target),{method:'POST',redirect:'error',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':'2025-11-25','cf-connecting-ip':clientIp,...extra},body,signal:AbortSignal.timeout(8000)});
 requests.push({url:target,method:'POST',params,body});assert.equal(response.status,200);assert.equal(response.headers.get('x-test-outbound-attempts'),'0');
 const data=await response.json();assert.equal(data.error,undefined,JSON.stringify(data.error));return data.result;
}
const result=async(name,args={},extra={})=>rpc('tools/call',{name,arguments:args},extra);
async function tool(name,args={}){const r=await result(name,args);assert.notEqual(r.isError,true,JSON.stringify(r.structuredContent));return r.structuredContent;}
const state=()=>tool('read_state'),nonce=signer=>tool('get_nonce',{signer});
async function packet(name,action,key,requestId,maxTotal,expectedVersion){
 const signer=nativePrincipal(key),cap=await tool('read_capabilities'),quote=await tool('quote_domain',{name,action,signer});
 if(expectedVersion!==undefined)assert.equal(quote.expectedVersion,expectedVersion,'STALE_VERSION');
 assert.ok(BigInt(quote.requiredMaxTotal)<=BigInt(maxTotal),'ITEM_CAP_EXCEEDED');
 pinIdentity(cap);const snap=await state(),n=await nonce(signer);
 const body=prepare({signer,coSigners:[],requestId,nonce:n.nonce,notBefore:snap.observedServerTime,deadline:snap.observedServerTime+300000,maxTotal,maxNetworkFee:'0',action,params:quote.params},cap);
 signatures++;return signBody(body,[key]);
}
async function preview(p){const before=await state(),n=await nonce(p.body.signer),r=await tool('simulate_intent',p);assert.equal(r.wouldSucceed,true,JSON.stringify(r));assert.deepEqual(await state(),before);assert.deepEqual(await nonce(p.body.signer),n);}
function storedReceipt(receipt){const {accepted,durability,finality,...stored}=receipt;assert.equal(accepted,true);assert.equal(durability,'volatile-memory');assert.equal(finality,'registry-committed');return stored;}
async function committed(p){await preview(p);const receipt=await tool('submit_intent',p);assert.equal(receipt.status,'succeeded');const polled=await tool('get_receipt',{id:intentId(p.body)});assert.deepEqual(polled,storedReceipt(receipt));return receipt;}
async function validateCart(cart){
 await validateAgentCartHandoff(cart); // request IDs, exact per-item and whole-cart caps
 const cap=await tool('read_capabilities');pinIdentity(cap);for(const key of ['revision','chainId','genesisHash','registryId','policyHash','normalizationHash'])assert.equal(cart[key],cap[key],'REGISTRY_IDENTITY');
 assert.equal(cart.endpoint,base);assert.equal(cart.mcp.url,'https://poadomains.grok.me/mcp'); // production discovery is NOT followed
 const snapshot=await state();if(snapshot.state.sequence===cart.sequence)assert.equal(snapshot.stateHash,cart.stateHash);
}
async function fromCart(cart,{loseBid=false}={}){
 await validateCart(cart);const used={};let last;
 for(const item of cart.items)for(const op of item.operations){
  used[item.asset]=(used[item.asset]??0n)+BigInt(op.maxTotal);
  assert.ok(used[item.asset]<=BigInt(cart.spendingCapByAsset[item.asset]),'CART_CAP_EXCEEDED');
  const p=await packet(item.name,op.action,keys[0],op.requestId,op.maxTotal,op.expectedVersion);
  if(op.auctionIdFrom)assert.equal(p.body.params.auctionId,last.result.auctionId);
  assert.equal(p.body.params.asset??item.asset,item.asset);if(op.action==='announceAuction')assert.equal(p.body.params.reserve,item.params.reserve);
  if(loseBid&&op.action==='bid'){
   await preview(p);const before=await state(),n=await nonce(buyer),serialized=JSON.stringify(p),id=intentId(p.body);
   const lost=await result('submit_intent',p,{'x-test-drop-reply':'once'});assert.equal(lost.isError,true);assert.equal(lost.structuredContent.accepted,'unknown');
   const missing=await result('get_receipt',{id});assert.equal(missing.isError,true);assert.equal(missing.structuredContent.code,'UNKNOWN_OUTCOME');
   // UNKNOWN remains budget-reserved. No new signing, requestId, nonce or cart regeneration.
   const count=signatures;last=await tool('submit_intent',JSON.parse(serialized));assert.equal(last.status,'succeeded');assert.equal(signatures,count);assert.equal(intentId(p.body),id);
   const calls=requests.filter(r=>r.params.name==='submit_intent'&&r.params.arguments.body.requestId===p.body.requestId);assert.equal(calls.length,2);assert.equal(JSON.stringify(calls[0].params.arguments),JSON.stringify(calls[1].params.arguments));
   assert.deepEqual(await tool('get_receipt',{id}),storedReceipt(last));const after=await state();assert.equal(after.state.sequence,before.state.sequence+1);assert.equal((await nonce(buyer)).nonce,n.nonce+1);
   assert.equal(BigInt(before.state.balances[buyer].POA)-BigInt(after.state.balances[buyer].POA),BigInt(p.body.params.amount));
  }else last=await committed(p);
 }
 return last;
}
async function human(name){
 await page.goto(base+'/');await page.waitForFunction(()=>document.body.dataset.registryStatus==='ready');await page.locator('#searchInput').fill(name);await page.locator('#searchBtn').click();await expect(page.locator('#addToCartBtn')).toBeVisible();
 await page.locator('#addToCartBtn').click();await expect(page.locator('#copyCartPrompt')).toBeEnabled();await page.locator('#copyCartPrompt').click();
 const text=await page.evaluate(()=>window.__copied.at(-1));assert.match(text,/Agent Cart Handoff v2/);return JSON.parse(text.split('```json\n')[1].split('\n```')[0]);
}
let page;
try{
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Local workerd exited: '+logPath);try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(500)});if(r.ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Local workerd startup: '+logPath);
 await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'local-agent-journey',version:'1'}});
 pinIdentity(await tool('read_capabilities'));
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',async route=>{const req=route.request();if(new URL(req.url()).origin!==base||req.method()!=='GET'||new URL(req.url()).pathname.startsWith('/v1/escrow/')){blocked.push(req.url());return route.abort();}return route.continue();});
 await page.addInitScript(()=>{window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.__copied.push(text)}});});
 const cart=await human('journeyalpha');assert.equal(cart.items[0].action,'announceAuction+bid');
 const before=await state(),beforeNonce=await nonce(buyer),count=signatures,bad=structuredClone(cart);bad.spendingCapByAsset.POA='0';
 await assert.rejects(()=>fromCart(bad),/Whole-cart spending cap mismatch/);assert.equal(signatures,count);assert.deepEqual(await state(),before);assert.deepEqual(await nonce(buyer),beforeNonce);
 await fromCart(cart,{loseBid:true});
 // A second copied cart becomes stale after a competitor outbids through the same MCP.
 clientIp="192.0.2.15";await page.locator('#clearCart').click();const stale=await human('journeyalpha');assert.equal(stale.items[0].action,'bid');
 const q=await tool('quote_domain',{name:'journeyalpha',action:'bid',signer:rival});const rivalPacket=await packet('journeyalpha','bid',keys[2],'local-rival-bid',q.requiredMaxTotal,q.expectedVersion);await committed(rivalPacket);
 const unchanged=await state(),n=await nonce(buyer),signed=signatures;await assert.rejects(()=>fromCart(stale),/STALE_VERSION/);assert.equal(signatures,signed);assert.deepEqual(await state(),unchanged);assert.deepEqual(await nonce(buyer),n);
 // The real production preview also rejects the stale packet without consuming anything.
 const cap=await tool('read_capabilities');const stalePacket=signBody(prepare({signer:buyer,coSigners:[],requestId:'local-stale-preview',nonce:n.nonce,notBefore:unchanged.observedServerTime,deadline:unchanged.observedServerTime+300000,maxTotal:stale.items[0].maxTotal,maxNetworkFee:'0',action:'bid',params:{...q.params,beneficiary:buyer}},cap),[keys[0]]);
 const staleResult=await result('simulate_intent',stalePacket);assert.equal(staleResult.isError,true);const stalePreview=staleResult.structuredContent;assert.equal(stalePreview.wouldSucceed,false);assert.equal(stalePreview.receipt.code,'STALE_VERSION');assert.deepEqual(await state(),unchanged);assert.deepEqual(await nonce(buyer),n);
 await page.evaluate(async()=>{const query=new URL(document.querySelector('script[src*="app.js"]').src).search;await(await import('/ui-poll.js'+query)).refreshRegistry();});await expect(page.locator('#copyCartPrompt')).toBeDisabled();
 // Owner journey uses a separate human-selected name, preserving the stale failure's evidence.
 clientIp="192.0.2.16";await page.locator('#clearCart').click();const winnerCart=await human('journeywinner');await fromCart(winnerCart);
 const finish=await packet('journeywinner','finalize',keys[0],'local-finalize-owner','0');await committed(finish);const resolved=await tool('resolve_domain',{name:'journeywinner'});assert.equal(resolved.deed.owner,buyer);
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.ok(requests.every(r=>r.method==='POST'&&r.url===target));
 assert.doesNotMatch(readFileSync(logPath,'utf8'),/TEST_OUTBOUND_FORBIDDEN|TEST_ESCROW_FORBIDDEN/);
 console.log('PASS local HTTP MCP agent journey: real Chromium search/add/copy v2 -> identity/quote/local sign/simulate/submit/receipt/resolve owner; stale outbid abort, whole-cart cap abort, UNKNOWN+missing receipt exact resend commits/debits once; '+requests.length+' POST /mcp calls; zero outbound, escrow or production actions');
}catch(e){console.error('Local fixture log: '+logPath);throw e;}
finally{await browser?.close();if(child.exitCode===null){const exit=once(child,'exit');process.kill(-child.pid,'SIGTERM');await exit;}}
