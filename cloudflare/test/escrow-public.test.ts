// Deterministic synthetic identities, local mock network only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { canonical } from '../../src/core.js';
import { base58 } from '../../src/native-crypto.js';
import { Escrow, invariant } from '../escrow.js';
import { publicCommand, accountView, marketView, marketPage } from '../escrow-public.js';
import { escrowHttp } from '../escrow-http.js';
import { envelopeResponse, ERROR_CATALOGUE } from '../../src/errors.js';
import { MemoryJournal, MockNetwork, policy, signer, who, key, command, depositBody } from './escrow-fixture.js';
const packet=(actor:number,action:string,params:Record<string,unknown>,id='public-1',changes={})=>{const c={...command(who(actor),id,action,params),expires:1800001800,...changes};return JSON.stringify({command:c,signature:base58(sign(null,Buffer.from(canonical(c)),key(actor)))});};
function fixture(){const net=new MockNetwork(),journal=new MemoryJournal(policy),titles={terms:()=>({reserve:'1.000000',window:86400000,quiet:86400000}),validate:()=>{},commit:()=>{}};return {net,journal,escrow:new Escrow(journal,net,signer(),titles,policy,()=>net.now,()=>true)};}
async function call(e:ReturnType<typeof fixture>,actor:number,action:string,params:Record<string,unknown>,id:string,endpoint='command'){return publicCommand(()=>e.escrow,packet(actor,action,params,id,{expires:Math.floor(e.net.now/1000)+1800}),'test-registry',endpoint,e.net.now);}
async function fund(e:ReturnType<typeof fixture>,actor:number,amount:string,id:string,final=true){const x:any=await call(e,actor,'intent',{amount},id,'intent'),intent=x.result.intent;const txid=e.net.add(depositBody(actor,policy.wallet,amount,intent),final?5:0,final);if(final)await call(e,actor,'detect',{intent,txid},id+'-detect');return {intent,txid};}
test('public signatures reject impersonation, changed fields, wrong chain/registry, expiry and admin actions before initializing escrow',async()=>{let calls=0;const get=()=>{calls++;throw Error('MUST_NOT_INIT');};for(const text of ['{}',packet(3,'intent',{amount:'1.000000'},'x',{actor:who(4)}),packet(3,'intent',{amount:'1.000000'},'x',{chainId:'wrong'}),packet(3,'intent',{amount:'1.000000'},'x',{registryId:'wrong'}),packet(3,'intent',{amount:'1.000000'},'x',{expires:1800000000}),packet(3,'intent',{amount:'1.000000'},'x',{expires:1800003601}),packet(3,'pause',{paused:false})])await assert.rejects(()=>publicCommand(get,text,'test-registry','intent',1800000000000));assert.equal(calls,0);});
test('every intent/withdraw/account endpoint binds its own signed action and limits without accepting redirection',async()=>{const e=fixture();await e.escrow.pause(false);for(const [action,endpoint] of [['withdraw','intent'],['intent','withdraw'],['intent','account']] as const)await assert.rejects(()=>call(e,3,action,{amount:'1.000000'},action,endpoint),/ESCROW_ENDPOINT_ACTION/);await assert.rejects(()=>call(e,3,'intent',{amount:'10000.000001'},'oversize','intent'),/ESCROW_PAYOUT_LIMIT/);await assert.rejects(()=>call(e,3,'withdraw',{amount:'1.000000',to:who(4)},'redirect','withdraw'));assert.equal(e.escrow.state().sequence,1);});
test('signed account is read-only, payer-scoped, repeatable, and available while operator setup is held',async()=>{const e=fixture();await e.escrow.pause(false);await fund(e,3,'3.000000','fund');const seq=e.escrow.state().sequence;const a:any=await publicCommand(()=>e.escrow,packet(4,'view',{}),'test-registry','account',e.net.now,false);assert.equal(a.account.payer,who(4));assert.equal(a.account.available,'0.000000');assert.equal(a.account.deposits.length,0);assert.equal(e.escrow.state().sequence,seq);assert.equal(e.net.calls,0);await assert.rejects(()=>publicCommand(()=>e.escrow,packet(3,'withdraw',{amount:'1.000000'}),'test-registry','withdraw',e.net.now,false),/ESCROW_OPERATOR_SETUP_HELD/);});
test('public intent replay is exact; changed payload cannot create a second obligation',async()=>{const e=fixture();await e.escrow.pause(false);const a:any=await call(e,3,'intent',{amount:'1.000000'},'once','intent');const b:any=await call(e,3,'intent',{amount:'1.000000'},'once','intent');assert.deepEqual(a,b);await assert.rejects(()=>call(e,3,'intent',{amount:'2.000000'},'once','intent'),/ESCROW_IDEMPOTENCY_CONFLICT/);assert.equal(Object.keys(e.escrow.state().deposits).length,1);});
test('read-only receipt states wait, see a verified bound transfer, and show final only after signed credit',async()=>{const e=fixture();await e.escrow.pause(false);const {intent,txid}=await fund(e,3,'1.000000','receipt',false);assert.equal((await e.escrow.depositView(intent) as any).status,'waiting');assert.equal((await e.escrow.depositView(intent,txid) as any).status,'seen');const seq=e.escrow.state().sequence;assert.equal(e.escrow.state().assets,'0');assert.equal(e.net.calls,0);e.net.txs[txid]!.valid=false;assert.equal((await e.escrow.depositView(intent,txid) as any).status,'waiting');e.net.txs[txid]!.valid=true;e.net.txs[txid]!.attestations=5;assert.equal((await e.escrow.depositView(intent,txid) as any).status,'seen');assert.equal(e.escrow.state().sequence,seq);await call(e,3,'detect',{intent,txid},'credit');assert.equal((await e.escrow.depositView(intent,txid) as any).status,'final');assert.equal(e.escrow.state().assets,'1000000');});
test('fixed-price purchase reserves exact funds, rejects bid/wrong price and preserves public history',async()=>{const e=fixture();await e.escrow.pause(false);await fund(e,3,'5.000000','fixed-fund');const x:any=await call(e,2,'list',{name:'name',price:'2.000000'},'fixed-list');const auction=x.result.auction;await assert.rejects(()=>call(e,3,'bid',{auction,amount:'2.000000'},'wrong-kind'),/ESCROW_MARKET_KIND/);await assert.rejects(()=>call(e,3,'buy',{auction,amount:'2.000001'},'wrong-price'),/ESCROW_PRICE/);await call(e,3,'buy',{auction,amount:'2.000000'},'fixed-buy');assert.equal(e.escrow.state().available[who(3)],'3000000');assert.equal(e.escrow.state().auctions[auction]!.high!.payer,who(3));await assert.rejects(()=>call(e,4,'buy',{auction,amount:'2.000000'},'twice'));assert.equal(marketView(e.escrow.state())[0]!.kind,'fixed');assert.equal(marketView(e.escrow.state())[0]!.history.length,2);invariant(e.escrow.state());assert.equal(e.net.calls,0);});
test('marketView reports awaitingFirstBid until first bid starts timer, exact >10% minimumNextBid, and bidder history for outbid tracking',async()=>{
 const e=fixture();await e.escrow.pause(false);
 await fund(e,3,'10.000000','m3');await fund(e,4,'10.000000','m4');
 const opened:any=await call(e,2,'open',{name:'popular',reserve:'2.000000'},'open-pop');
 const before=marketView(e.escrow.state(),'popular')[0]!;
 assert.equal(before.awaitingFirstBid,true);assert.equal(before.closes,0);assert.equal(before.startedAt,null);assert.equal(before.minimumNextBid,'2.000000');assert.deepEqual(before.bidders,[]);
 const startMs=e.net.now+5000;e.net.now=startMs;
 await call(e,3,'bid',{auction:opened.result.auction,amount:'2.000000'},'bid-3');
 const acc3Leading=accountView(e.escrow.state(),who(3));
 assert.equal(acc3Leading.available,'8.000000');assert.equal(acc3Leading.lockedInAuctions,'2.000000');
 const live=marketView(e.escrow.state(),'popular')[0]!;
 assert.equal(live.awaitingFirstBid,false);assert.equal(live.startedAt,startMs);assert.equal(live.closes,startMs+86400000);assert.equal(live.minimumNextBid,'2.200001');assert.deepEqual(live.bidders,[who(3)]);
 await call(e,4,'bid',{auction:opened.result.auction,amount:'3.000000'},'bid-4');
 // Outbid returns who(3)'s 2 POA immediately to available balance (locked drops to 0) so who(3) can re-bid or withdraw right away.
 const acc3Outbid=accountView(e.escrow.state(),who(3));
 assert.equal(acc3Outbid.available,'10.000000');assert.equal(acc3Outbid.lockedInAuctions,'0.000000');
 const acc4Leading=accountView(e.escrow.state(),who(4));
 assert.equal(acc4Leading.available,'7.000000');assert.equal(acc4Leading.lockedInAuctions,'3.000000');
 const outbid=marketView(e.escrow.state(),'popular')[0]!;
 assert.equal(outbid.high?.payer,who(4));assert.equal(outbid.high?.amount,'3.000000');assert.equal(outbid.minimumNextBid,'3.300001');assert.deepEqual(outbid.bidders,[who(3),who(4)]);
});
test('public projections contain no signed request, retained outbox body, title consent or journal',async()=>{const e=fixture();await e.escrow.pause(false);await fund(e,3,'1.000000','private');await call(e,3,'withdraw',{amount:'1.000000'},'refund','withdraw');await e.escrow.tick();const text=JSON.stringify({market:marketView(e.escrow.state()),account:accountView(e.escrow.state(),who(3))});for(const field of ['"body"','"packet"','"requests"','"signature"','"sig"','"journal"'])assert(!text.includes(field));assert(text.includes('UNKNOWN'));});
test('freshness/paused UI display cannot bypass uncached financial hold',async()=>{const e=fixture();await e.escrow.pause(false);assert.equal((await e.escrow.readiness()).held,false);e.net.stale=true;await assert.rejects(()=>call(e,3,'intent',{amount:'1.000000'},'stale','intent'),/ESCROW_STALE/);e.net.now+=10001;assert.equal((await e.escrow.readiness()).held,true);assert.equal(e.net.calls,0);});
const env={POA_ESCROW_ENABLED:'true',PUBLIC_EXPLORER_URL:'https://app.example'};
const req=(path:string,body='{}',headers:Record<string,string>={})=>new Request('https://app.example/v1/escrow/'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body});
for(const [name,request] of [
 ['unsigned',req('intent')],['duplicate JSON fields',req('intent','{"command":{},"command":{},"signature":"x"}')],['prototype JSON',req('intent','{"command":{},"signature":"x","__proto__":{}}')],['oversize',req('intent','x'.repeat(65537))],['compressed',req('intent','{}',{'content-encoding':'gzip'})],['cross-origin',req('intent','{}',{origin:'https://evil.example'})],['cross-site',req('intent','{}',{'sec-fetch-site':'cross-site'})],['admin credential',req('withdraw','{}',{authorization:'Bearer not-an-admin-token'})],['duplicate query',new Request('https://app.example/v1/escrow/intent?id=x&id=y')],['unknown query',new Request('https://app.example/v1/escrow/market?token=x')],['invalid txid',new Request('https://app.example/v1/escrow/intent?id='+'a'.repeat(64)+'&txid=bad')],['wrong method',new Request('https://app.example/v1/escrow/withdraw')]
] as const)test('HTTP rejects '+name+' before dispatch',async()=>{let calls=0;const r=await escrowHttp(request,env,()=>{calls++;throw Error('MUST_NOT_DISPATCH');});assert(r.status>=400);assert.equal(calls,0);assert.equal(r.headers.get('cache-control'),'no-store');});
test('OFF capabilities are neutral; every other public route is absent without initializing RPC or networking',async()=>{for(const path of ['capabilities','market','domain?name=x','intent?id='+'a'.repeat(64)]){let calls=0;const r=await escrowHttp(new Request('https://app.example/v1/escrow/'+path),{...env,POA_ESCROW_ENABLED:'false'},()=>{calls++;throw Error('MUST_NOT_INIT');});assert.equal(r.status,path==='capabilities'?200:404);if(path==='capabilities')assert.deepEqual((await r.json() as any).enabled,false);assert.equal(calls,0);}});

test('post-dispatch storage/outcome failures are UNKNOWN, never falsely rejected',async()=>{for(const error of [Error('ESCROW_UNAVAILABLE'),Error('storage failed after commit')]){const r=await escrowHttp(req('intent',packet(3,'intent',{amount:'1.000000'})),env,()=>({escrowRead:async()=>({}),escrowCommand:async()=>{throw error;}}));assert.equal(r.status,503);assert.equal((await r.json() as any).accepted,'unknown');}});
test('known pre-write business failure stays rejected without exposing details',async()=>{const r=await escrowHttp(req('withdraw',packet(3,'withdraw',{amount:'1.000000'})),env,()=>({escrowRead:async()=>({}),escrowCommand:async()=>{throw Error('ESCROW_PAUSED');}}));assert.equal(r.status,409);assert.equal((await r.json() as any).accepted,false);});

test('slow overlapping display probes are one flight even after 10s; cache TTL starts when settled',async()=>{
 const e=fixture();await e.escrow.pause(false);let probes=0,release!:(v:any)=>void;
 Object.assign(e.net,{displayStatus:()=>{probes++;return new Promise(r=>{release=r;});}});
 const first=e.escrow.readiness();e.net.now+=11000;
 const second=e.escrow.readiness();assert.equal(first,second);assert.equal(probes,1);
 release({chain:e.net.chain,asOf:e.net.now,stale:false,height:10,root:'a'.repeat(64),fee:'0.000000'});
 const shown=await first;assert.equal(shown.held,false);assert.equal(shown.durationMs,11000);assert.equal(shown.slow,true);assert.equal(shown.code,null);
 e.net.now+=9999;assert.equal((await e.escrow.readiness()).held,false);assert.equal(probes,1);
 e.net.now+=2;const next=e.escrow.readiness();assert.equal(probes,2);release(await e.net.status());await next;assert.equal(e.net.calls,0);
});
test('inflight or cached display success cannot authorize a stale signed financial command',async()=>{
 const e=fixture();await e.escrow.pause(false);let release!:(v:any)=>void;Object.assign(e.net,{displayStatus:()=>new Promise(r=>{release=r;})});
 const pending=e.escrow.readiness(),before=e.escrow.state();e.net.stale=true;
 await assert.rejects(()=>call(e,3,'intent',{amount:'1.000000'},'pending-display','intent'),/ESCROW_STALE/);
 release({...await e.net.status(),stale:false});assert.equal((await pending).held,false);
 await assert.rejects(()=>call(e,3,'intent',{amount:'1.000000'},'cached-display','intent'),/ESCROW_STALE/);
 assert.deepEqual(e.escrow.state(),before);assert.equal(e.net.calls,0);
});
test('display success expires at the unchanged financial age limit, not only its TTL',async()=>{
 const e=fixture();let probes=0;const asOf=e.net.now-89000;Object.assign(e.net,{displayStatus:async()=>{probes++;return {...await e.net.status(),asOf};}});
 assert.equal((await e.escrow.readiness()).held,false);e.net.now+=1001;
 const shown=await e.escrow.readiness();assert.equal(shown.held,true);assert.equal(shown.code,'ESCROW_STALE');assert.equal(probes,2);
});
test('display error telemetry is bounded public codes, never raw private exception details',async()=>{
 const e=fixture();Object.assign(e.net,{displayStatus:async()=>{throw Error('synthetic-private-node-url-and-credential');}});
 const shown=await e.escrow.readiness();assert.equal(shown.held,true);assert.equal(shown.code,'ESCROW_NODE_UNAVAILABLE');assert.equal(shown.timing,null);assert.ok(!JSON.stringify(shown).includes('synthetic-private'));
});

function tieredFixture(){
 const net=new MockNetwork(),journal=new MemoryJournal(policy);
 const titles={
  terms:(name:string)=>{
   const prem=name.startsWith('prem')||name==='🚀';
   return {reserve:'1.000000',window:prem?86400000:3600000,quiet:prem?86400000:3600000};
  },
  validate:()=>{},
  commit:()=>{},
 };
 return {net,journal,escrow:new Escrow(journal,net,signer(),titles,policy,()=>net.now,()=>true)};
}

test('marketPage filters, sorts (asc/desc with queued closes=0 last), tracks since deltas, and preserves minimumNextBid + anti-sniping rules',async()=>{
 const e=tieredFixture();await e.escrow.pause(false);
 await fund(e,3,'5000.000000','f3');await fund(e,4,'5000.000000','f4');

 // 1. Standard queued auction (1h/1h, 100 POA reserve)
 e.net.now=1800000000000;
 const stdA:any=await call(e,2,'open',{name:'stdalpha',reserve:'100.000000'},'open-std-a');
 // 2. Premium queued auction (24h/24h, 1000 POA reserve)
 e.net.now=1800000010000;
 const premA:any=await call(e,2,'open',{name:'premone',reserve:'1000.000000'},'open-prem-a');
 // 3. Standard queued auction (1h/1h, 250 POA reserve) - stays queued (closes=0)
 e.net.now=1800000020000;
 const stdQueued:any=await call(e,2,'open',{name:'stdqueued',reserve:'250.000000'},'open-std-q');
 // 4. Standard fixed-price listing (150 POA)
 e.net.now=1800000030000;
 const fixedItem:any=await call(e,2,'list',{name:'stdfixed',price:'150.000000'},'list-fixed');
 // 5. Cancelled standard auction (50 POA)
 e.net.now=1800000040000;
 const cancelledA:any=await call(e,2,'open',{name:'stdcancelled',reserve:'50.000000'},'open-cancel');
 await call(e,2,'cancel',{auction:cancelledA.result.auction},'do-cancel');

 const seqBeforeBids=e.escrow.state().sequence;

 // First bid on stdA starts 1h timer; first bid on premA starts 24h timer
 e.net.now=1800000100000;
 await call(e,3,'bid',{auction:stdA.result.auction,amount:'100.000000'},'bid-std-1');
 // Exact 10% raise (110.000000) MUST still be rejected; strict >10% (110.000001) succeeds and triggers anti-snipe quiet extension!
 e.net.now=1800000100000+1800000; // 30m into 1h window (inside 1h quiet window)
 await assert.rejects(()=>call(e,4,'bid',{auction:stdA.result.auction,amount:'110.000000'},'bid-std-exact10'),/ESCROW_BID_INCREMENT/);
 await call(e,4,'bid',{auction:stdA.result.auction,amount:'110.000001'},'bid-std-2');
 const stdAfterSnipe=e.escrow.state().auctions[stdA.result.auction]!;
 assert.equal(stdAfterSnipe.closes,e.net.now+3600000,'standard anti-snipe extends close by 1h quiet period');

 // First bid on premA starts 24h timer; late bid extends by 24h quiet period
 e.net.now=1800000100000+2000000;
 await call(e,3,'bid',{auction:premA.result.auction,amount:'1000.000000'},'bid-prem-1');
 e.net.now=1800000100000+2500000;
 await call(e,4,'bid',{auction:premA.result.auction,amount:'1200.000000'},'bid-prem-2');
 const premAfterSnipe=e.escrow.state().auctions[premA.result.auction]!;
 assert.equal(premAfterSnipe.closes,e.net.now+86400000,'premium anti-snipe extends close by 24h quiet period');

 const nowMs=e.net.now;
 const s=e.escrow.state();

 // Verify item fields unchanged (including minimumNextBid, closes, window, quiet, awaitingFirstBid, history)
 const stdItem=marketPage(s,{name:'stdalpha'},nowMs).items[0]!;
 assert.equal(stdItem.minimumNextBid,'121.000002');
 assert.equal(stdItem.closes,stdAfterSnipe.closes);
 assert.equal(stdItem.window,3600000);
 assert.equal(stdItem.quiet,3600000);
 assert.equal(stdItem.awaitingFirstBid,false);
 assert.equal(stdItem.high?.amount,'110.000001');
 assert.equal(stdItem.history.length,3);

 // Filter: tier (standard vs premium)
 const premOnly=marketPage(s,{tier:'premium'},nowMs);
 assert.deepEqual(premOnly.items.map(x=>x.name),['premone']);
 const stdOnly=marketPage(s,{tier:'standard'},nowMs);
 assert.equal(stdOnly.items.some(x=>x.name==='premone'),false);
 assert.equal(stdOnly.total,4);

 // Filter: kind (auction vs fixed)
 assert.deepEqual(marketPage(s,{kind:'fixed'},nowMs).items.map(x=>x.name),['stdfixed']);
 assert.equal(marketPage(s,{kind:'auction'},nowMs).total,4);

 // Filter: status & phase
 assert.deepEqual(marketPage(s,{status:'CANCELLED'},nowMs).items.map(x=>x.name),['stdcancelled']);
 assert.deepEqual(marketPage(s,{phase:'queued'},nowMs).items.map(x=>x.name),['stdqueued']);
 assert.deepEqual(marketPage(s,{phase:'closed'},nowMs).items.map(x=>x.name),['stdcancelled']);
 assert.deepEqual(marketPage(s,{phase:'live',kind:'auction'},nowMs).items.map(x=>x.name),['stdalpha','premone']);

 // Filter: minPrice / maxPrice against current high bid (or reserve if unbid)
 // Effective prices: stdcancelled=50, stdalpha=110.000001 (high bid!), stdfixed=150, stdqueued=250, premone=1200 (high bid!)
 assert.deepEqual(marketPage(s,{minPrice:'110.000001',maxPrice:'250',sort:'price',order:'asc'},nowMs).items.map(x=>x.name),['stdalpha','stdfixed','stdqueued']);
 assert.deepEqual(marketPage(s,{minPrice:'110.000002',sort:'price',order:'asc'},nowMs).items.map(x=>x.name),['stdfixed','stdqueued','premone']);
 assert.deepEqual(marketPage(s,{maxPrice:'110.000001',sort:'price',order:'desc'},nowMs).items.map(x=>x.name),['stdalpha','stdcancelled']);

 // Filter: closesBefore (unix seconds; ONLY live auctions closing strictly before it — excludes queued, closed, fixed)
 const afterStdBeforePremSec=Math.floor((stdAfterSnipe.closes+60000)/1000);
 assert.deepEqual(marketPage(s,{closesBefore:String(afterStdBeforePremSec)},nowMs).items.map(x=>x.name),['stdalpha']);
 const exactStdCloseSec=Math.floor(stdAfterSnipe.closes/1000);
 assert.deepEqual(marketPage(s,{closesBefore:String(exactStdCloseSec)},nowMs).items,[]);
 const afterBothSec=Math.floor((premAfterSnipe.closes+60000)/1000);
 assert.deepEqual(marketPage(s,{closesBefore:String(afterBothSec)},nowMs).items.map(x=>x.name),['stdalpha','premone']);

 // Sort: closes asc & desc — queued closes=0 MUST sort LAST in BOTH orders!
 const closesAsc=marketPage(s,{status:'OPEN',sort:'closes',order:'asc'},nowMs).items.map(x=>x.name);
 assert.equal(closesAsc[closesAsc.length-1],'stdqueued');
 assert.equal(closesAsc.indexOf('stdalpha')<closesAsc.indexOf('premone'),true);
 const closesDesc=marketPage(s,{status:'OPEN',sort:'closes',order:'desc'},nowMs).items.map(x=>x.name);
 assert.equal(closesDesc[closesDesc.length-1],'stdqueued');
 assert.equal(closesDesc[0],'premone');

 // Sort: price asc & desc
 assert.deepEqual(marketPage(s,{sort:'price',order:'asc'},nowMs).items.map(x=>x.name),['stdcancelled','stdalpha','stdfixed','stdqueued','premone']);
 assert.deepEqual(marketPage(s,{sort:'price',order:'desc'},nowMs).items.map(x=>x.name),['premone','stdqueued','stdfixed','stdalpha','stdcancelled']);

 // Sort: created asc & desc
 assert.deepEqual(marketPage(s,{sort:'created',order:'asc'},nowMs).items.map(x=>x.name),['stdalpha','premone','stdqueued','stdfixed','stdcancelled']);
 assert.deepEqual(marketPage(s,{sort:'created',order:'desc'},nowMs).items.map(x=>x.name),['stdcancelled','stdfixed','stdqueued','premone','stdalpha']);

 // Delta sync via since + sequence
 const fullPage=marketPage(s,{},nowMs);
 assert.equal(fullPage.sequence,s.sequence);
 assert.equal(fullPage.hasMore,false);
 assert.equal(fullPage.nextCursor,null);
 assert.deepEqual(marketPage(s,{since:String(fullPage.sequence)},nowMs).items,[]);
 const changedAfterBeforeBids=marketPage(s,{since:String(seqBeforeBids),sort:'created',order:'asc'},nowMs);
 assert.deepEqual(changedAfterBeforeBids.items.map(x=>x.name),['stdalpha','premone']);
 assert.equal(marketPage(s,{since:'0'},nowMs).total,5);

 // Legacy pre-upgrade auction (updatedSequence omitted) is included for since=0 and excluded for since=current
 const legacyState=structuredClone(s);
 delete legacyState.auctions[fixedItem.result.auction]!.updatedSequence;
 assert.equal(marketPage(legacyState,{since:'0',name:'stdfixed'},nowMs).total,1);
 assert.equal(marketPage(legacyState,{since:String(legacyState.sequence),name:'stdfixed'},nowMs).total,0);
});

test('marketPage pages >100 auctions with zero duplicates or gaps across all sort/order pairs and stays stable across concurrent bids',async()=>{
 const e=tieredFixture();await e.escrow.pause(false);
 await fund(e,3,'5000.000000','big-fund-3');await fund(e,4,'5000.000000','big-fund-4');

 // Seed 110 queued auctions in one atomic entry + open 15 individual auctions at distinct timestamps/tiers/prices => 125 total!
 const batch=Array.from({length:110},(_,i)=>({
  name:i%11===0?`premseed${String(i).padStart(3,'0')}`:`stdseed${String(i).padStart(3,'0')}`,
  reserve:`${100+(i%20)*10}.000000`,
 }));
 e.net.now=1800000000000;
 const seededIds=e.escrow.seedInventoryAuctions(who(2),batch,'bulk-paging-test-v1');
 assert.equal(seededIds.length,110);

 const extraIds:string[]=[];
 for(let i=0;i<15;i++){
  e.net.now=1800000100000+i*10000;
  const r:any=await call(e,2,'open',{name:i%3===0?`premextra${i}`:`stdextra${i}`,reserve:`${50+i*25}.000000`},`open-ex-${i}`);
  extraIds.push(r.result.auction);
 }
 // Start 5 of the extra auctions with first bids so we have a mix of live (closes>0) and queued (closes=0)
 for(let i=0;i<5;i++){
  e.net.now=1800000300000+i*5000;
  await call(e,3,'bid',{auction:extraIds[i]!,amount:`${50+i*25}.000000`},`first-bid-${i}`);
 }

 const totalCount=125;
 const s0=e.escrow.state();
 assert.equal(Object.keys(s0.auctions).length,totalCount);

 // Default limit=50 pages through all 125 items in 3 pages (50 + 50 + 25)
 const defIds:string[]=[];
 let cur:string|null=null;
 const pageSizes:number[]=[];
 do{
  const p=marketPage(s0,cur?{cursor:cur}:{},e.net.now);
  assert.equal(p.total,totalCount);
  assert.equal(p.sequence,s0.sequence);
  pageSizes.push(p.items.length);
  defIds.push(...p.items.map(x=>x.id));
  assert.equal(p.hasMore,p.nextCursor!==null);
  cur=p.nextCursor;
 }while(cur);
 assert.deepEqual(pageSizes,[50,50,25]);
 assert.equal(new Set(defIds).size,totalCount);

 // Every (sort, order) pair with limit=27 covers all 125 items with 0 duplicates and 0 gaps
 for(const sort of ['closes','price','created'] as const){
  for(const order of ['asc','desc'] as const){
   const collected:any[]=[];
   let cursor:string|null=null;
   while(true){
    const page=marketPage(s0,{sort,order,limit:'27',...(cursor?{cursor}:{})},e.net.now);
    collected.push(...page.items);
    if(!page.hasMore){assert.equal(page.nextCursor,null);break;}
    assert.ok(page.nextCursor);
    cursor=page.nextCursor;
   }
   assert.equal(collected.length,totalCount,`${sort}/${order} count`);
   assert.equal(new Set(collected.map(x=>x.id)).size,totalCount,`${sort}/${order} unique`);
   if(sort==='closes'){
    const firstQueuedIdx=collected.findIndex(x=>x.closes===0);
    assert.ok(firstQueuedIdx>0&&collected.slice(firstQueuedIdx).every(x=>x.closes===0),`${sort}/${order} queued sorted last`);
   }
  }
 }

 // Stability while new bids AND a cancellation arrive between pages!
 const p1=marketPage(e.escrow.state(),{sort:'created',order:'asc',limit:'40'},e.net.now);
 assert.equal(p1.items.length,40);assert.equal(p1.hasMore,true);
 const anchorId=p1.items[p1.items.length-1]!.id;
 // Cancel the EXACT cursor anchor auction AND place new bids on auctions on page 1 and later pages
 e.net.now+=1000;
 await call(e,2,'cancel',{auction:anchorId},'cancel-anchor');
 await call(e,4,'bid',{auction:extraIds[0]!,amount:'200.000000'},'concurrent-bid-1');
 await call(e,3,'bid',{auction:seededIds[90]!,amount:'200.000000'},'concurrent-bid-2');

 // Resume paging with p1.nextCursor against the mutated state: anchor was cancelled (still works!) and remaining 85 items appear with 0 duplicates/gaps
 const restIds:string[]=[];
 let nextCur=p1.nextCursor;
 while(nextCur){
  const page=marketPage(e.escrow.state(),{sort:'created',order:'asc',limit:'40',cursor:nextCur},e.net.now);
  restIds.push(...page.items.map(x=>x.id));
  nextCur=page.nextCursor;
 }
 const allCombined=[...p1.items.map(x=>x.id),...restIds];
 assert.equal(allCombined.length,totalCount);
 assert.equal(new Set(allCombined).size,totalCount);
});

test('HTTP /v1/escrow/market validates all inputs, adapts errors to 400 ErrorEnvelope without 500s, and dispatches valid paged queries',async()=>{
 const e=tieredFixture();await e.escrow.pause(false);
 const opened:any=await call(e,2,'open',{name:'httpitem',reserve:'100.000000'},'http-open');
 const validPage=marketPage(e.escrow.state(),{sort:'price',order:'asc',limit:'1'},e.net.now);
 assert.equal(validPage.items[0]!.id,opened.result.auction);
 // Open a second item to get a real cursor for cross-sort mismatch check
 await call(e,2,'open',{name:'httpitem2',reserve:'200.000000'},'http-open-2');
 const pricePage=marketPage(e.escrow.state(),{sort:'price',order:'asc',limit:'1'},e.net.now);
 assert.ok(pricePage.nextCursor);

 const badCases:[string,string][]=[
  ['limit=0','PAGE_LIMIT'],
  ['limit=101','PAGE_LIMIT'],
  ['limit=abc','PAGE_LIMIT'],
  ['limit=-5','PAGE_LIMIT'],
  ['cursor=','PAGE_CURSOR'],
  ['cursor=bad!cursor','PAGE_CURSOR'],
  ['cursor=AAAAAAAAAAAAAAAAAAAA','PAGE_CURSOR'],
  [`sort=closes&cursor=${pricePage.nextCursor}`,'PAGE_CURSOR'],
  [`sort=price&order=desc&cursor=${pricePage.nextCursor}`,'PAGE_CURSOR'],
  ['sort=invalid','INVALID_REQUEST'],
  ['order=sideways','INVALID_REQUEST'],
  ['status=RUNNING','INVALID_REQUEST'],
  ['kind=swap','ESCROW_MARKET_KIND'],
  ['phase=pending','INVALID_REQUEST'],
  ['tier=vip','INVALID_REQUEST'],
  ['minPrice=-1','ESCROW_AMOUNT'],
  ['minPrice=1.0000001','ESCROW_AMOUNT'],
  ['maxPrice=abc','ESCROW_AMOUNT'],
  ['minPrice=500&maxPrice=100','ESCROW_AMOUNT'],
  ['closesBefore=-1','INTEGER'],
  ['closesBefore=1800000000000','INTEGER'],
  ['closesBefore=soon','INTEGER'],
  ['since=-1','INTEGER'],
  ['since=abc','INTEGER'],
  ['name=','ESCROW_NAME'],
  ['foo=bar','QUERY_NOT_ALLOWED'],
  ['limit=10&limit=20','DUPLICATE_QUERY'],
 ];
 for(const [qs,expectedCode] of badCases){
  let calls=0;
  const raw=await escrowHttp(new Request(`https://app.example/v1/escrow/market?${qs}`),env,()=>{calls++;throw Error('MUST_NOT_DISPATCH');});
  assert.equal(calls,0,`should reject before dispatch: ${qs}`);
  const adapted=await envelopeResponse(raw,'req-market-test');
  assert.equal(adapted.status,400,`status for ${qs}`);
  const body=await adapted.json() as any;
  assert.equal(body.code,expectedCode,`code for ${qs}`);
  assert.equal(body.accepted,false);
  assert.equal(body.retryable,false);
  assert.equal(body.requestId,'req-market-test');
  assert.ok(Object.hasOwn(ERROR_CATALOGUE,body.code));
  assert.match(body.docs,/docs\/ERRORS\.md#/);
 }

 // Valid HTTP GET /v1/escrow/market dispatches to rpc.escrowRead('market', query)
 const rpc={
  escrowRead:async(path:string,query:Record<string,string>)=>{assert.equal(path,'market');return marketPage(e.escrow.state(),query,e.net.now);},
  escrowCommand:async()=>{throw Error('UNUSED');},
 };
 const okRes=await escrowHttp(new Request(`https://app.example/v1/escrow/market?sort=price&order=desc&limit=1&tier=standard&minPrice=100`),env,()=>rpc);
 assert.equal(okRes.status,200);
 const okBody=await okRes.json() as any;
 assert.equal(okBody.items.length,1);
 assert.equal(okBody.items[0].name,'httpitem2');
 assert.equal(okBody.hasMore,true);
 assert.ok(okBody.nextCursor);
 assert.equal(okBody.sequence,e.escrow.state().sequence);
});
