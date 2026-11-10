// Reproducible bounded property/fuzz checks. Seed is in every failing test name.
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {parse as configJSON} from 'jsonc-parser';
import assert from 'node:assert/strict';
import {canonical,exact,Fault,parseJSON} from '../src/core.js';
import {validateBody} from '../src/auth.js';
import {fixtureConfig} from '../src/config.js';
import {Engine} from '../src/engine.js';
import {ManualClock} from '../src/clock.js';
import {capabilities,prepare} from '../src/interface.js';
import {EMOJI17_ALIASES,manifest,normalizeName,type NormalizationMode} from '../src/names.js';
const seeds=[0x51f00d,0xcafebabe,0xdeadbeef];
function random(seed:number){let x=seed>>>0;return(n:number)=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)%n;};}
const rejected=(fn:()=>unknown)=>assert.throws(fn,(e:unknown)=>e instanceof Fault);
for(const seed of seeds){
 test(`parseJSON canonical round-trip, null prototypes and bounded hostile inputs; seed=${seed}`,()=>{
  const r=random(seed),words=['alpha','😀','❤️','quote"slash\\','é'];
  const value=(depth=0):any=>{
   const kind=r(depth<5?6:4);if(kind===0)return r(0x100000000);if(kind===1)return words[r(words.length)]!+r(1000);if(kind===2)return!!r(2);if(kind===3)return null;
   if(kind===4)return Array.from({length:r(5)},()=>value(depth+1));
   return Object.fromEntries(Array.from({length:r(5)},(_,i)=>['field'+i,value(depth+1)]));
  };
  const safe=(v:any):void=>{if(v&&typeof v==='object'){if(!Array.isArray(v))assert.equal(Object.getPrototypeOf(v),null);Object.values(v).forEach(safe);}};
  for(let i=0;i<500;i++){const v=value(),source=JSON.stringify(v),parsed=parseJSON(' \n'+source+'\t');assert.equal(canonical(parsed),canonical(v));safe(parsed);assert.equal(canonical(parseJSON(canonical(parsed))),canonical(v));}
  for(let i=0;i<200;i++){
   const n=r(100000)+1,key='field'+r(10000),escaped='\\u0066'+key.slice(1);
   rejected(()=>parseJSON(`{"${key}":1,"${escaped}":2}`));
   for(const token of [String(-n),n+'.5','NaN','Infinity','9007199254740992','01','true false'])rejected(()=>parseJSON('{"v":'+token+'}'));
  }
  for(const key of ['__proto__','constructor','prototype','privateKey','seed','mnemonic','api_key','password','authorization','secret'])rejected(()=>parseJSON(JSON.stringify({nested:{[key]:'synthetic'}})));
  for(const source of ['['.repeat(26)+'0'+']'.repeat(26),'['+Array(257).fill('0').join(',')+']','"\\ud800"','"\\udfff"','{"a":1,}','{"a":1}trailing'])rejected(()=>parseJSON(source));
  const unicode='"😀"';assert.equal(parseJSON(unicode,Buffer.byteLength(unicode)),'😀');assert.throws(()=>parseJSON(unicode,Buffer.byteLength(unicode)-1),/BODY_TOO_LARGE/);
  assert.equal(({} as any).polluted,undefined);
 });
 test(`exact schema presence/extras/type/nonmutation properties; seed=${seed}`,()=>{
  const r=random(seed);for(let i=0;i<500;i++){
   const required=Array.from({length:1+r(8)},(_,j)=>'required'+j),optional=['optional0','optional1'];
   const obj=Object.fromEntries([...required,...optional.filter(()=>r(2))].map(k=>[k,r(100000)])),before=JSON.stringify(obj);
   assert.equal(exact(obj,required,optional),obj);assert.equal(JSON.stringify(obj),before);
   for(const key of required){const missing={...obj};delete missing[key];rejected(()=>exact(missing,required,optional));}
   rejected(()=>exact({...obj,unlisted:r(10000)},required,optional));
   rejected(()=>exact(Object.create(obj),required,optional));
  }
  for(const v of [null,undefined,[],true,12,'object'])rejected(()=>exact(v,[]));
 });
 test(`validateBody safe integer counters, signatures, schema and secret boundaries; seed=${seed}`,()=>{
  const r=random(seed),who='ed25519:'+'1'.repeat(64),cap=capabilities(new Engine(fixtureConfig(who,'ed25519:'+'2'.repeat(64),[]),new ManualClock(1000000)));
  for(let i=0;i<200;i++){
   const body=prepare({signer:who,coSigners:[],requestId:'fuzz_'+seed+'_'+i,nonce:r(0x100000000),notBefore:r(1000000),deadline:2000000+r(1000000),maxTotal:(BigInt(r(0x100000000))*1000000000000000n+BigInt(r(1000000))).toString(),maxNetworkFee:'0',action:'finalize',params:{auctionId:'a'.repeat(64),expectedVersion:r(100000)}},cap),before=canonical(body);
   assert.equal(validateBody(body),body);assert.equal(canonical(body),before);assert.equal(canonical(validateBody(parseJSON(JSON.stringify(body)))),before);
   for(const key of Object.keys(body)){const missing:any={...body};delete missing[key];rejected(()=>validateBody(missing));}
   rejected(()=>validateBody({...body,unknown:true}));
   for(const key of ['nonce','notBefore','deadline'])for(const bad of [-1,0.5,'1',Number.MAX_SAFE_INTEGER+1,Infinity,NaN,null])rejected(()=>validateBody({...body,[key]:bad}));
   for(const requestId of ['', 'a'.repeat(65),'x/y','x y','🧾'])rejected(()=>validateBody({...body,requestId}));
   rejected(()=>validateBody({...body,notBefore:body.deadline}));rejected(()=>validateBody({...body,coSigners:[who]}));
   const other='ed25519:'+'3'.repeat(64);rejected(()=>validateBody({...body,coSigners:[other,other]}));
   rejected(()=>validateBody({...body,params:{nested:{privateKey:'synthetic-not-a-key'}}}));
   rejected(()=>validateBody({...body,params:{huge:Array(257).fill(0)}}));
   if(i===0)assert.throws(()=>validateBody({...body,params:Object.fromEntries(Array.from({length:4},(_,j)=>['field'+j,'a'.repeat(16000)]))}),/BODY_TOO_LARGE/);
  }
 });
 test(`normalization idempotence, alias/case/prefix equivalence and rejection bounds; seed=${seed}`,()=>{
  const r=random(seed);for(const mode of ['reference-subset','emoji17-full'] as NormalizationMode[]){
   const aliases=mode==='emoji17-full'?EMOJI17_ALIASES:manifest.aliases;
   for(let i=0;i<500;i++){
    const label=()=>Array.from({length:1+r(5)},()=>r(2)?String.fromCharCode(65+r(26)):aliases[r(aliases.length)]!.input).join('');
    const raw=label()+(r(3)===0?'.'+label():''),normalized=normalizeName(raw,mode);
    assert.deepEqual(normalizeName(normalized.canonical,mode),normalized);assert.deepEqual(normalizeName('poa:'+raw,mode),normalized);
    assert.ok(normalized.labels.every(l=>l.tokens.length>=1&&l.tokens.length<=32));
   }
   for(const invalid of ['', '.', 'a.', '.a','a..b','a.b.c','bad-name','bad_name','a b','a/b','\u200d','\ud800','a'.repeat(33)])rejected(()=>normalizeName(invalid,mode));
   assert.equal(normalizeName('MiXeD123',mode).canonical,'mixed123');
  }
 });
}

test('HTTP MCP agent journey is CI-covered and hard-isolated from production/escrow',()=>{
 const fixture=configJSON(readFileSync('cloudflare/test/agent-journey.wrangler.jsonc','utf8'));
 assert.equal(fixture.main,'agent-journey-worker.ts');assert.equal(fixture.ratelimits[0].simple.limit,60);
 for(const key of ['account_id','routes','durable_objects','r2_buckets','services','secrets','env'])assert.equal(fixture[key],undefined);
 assert.deepEqual(Object.keys(fixture.vars).sort(),['BACKEND_HOST','CONTRACT_CONFIG','PUBLIC_EXPLORER_URL']);
 const production=configJSON(readFileSync('wrangler.jsonc','utf8'));assert.notEqual(production.main,fixture.main);
 const worker=readFileSync('cloudflare/test/agent-journey-worker.ts','utf8'),journey=readFileSync('cloudflare/test/agent-journey.mjs','utf8');
 assert.match(worker,/globalThis\.fetch=async/);assert.match(worker,/runtime\?\?=import\("\.\.\/worker\.js"\)/);
 assert.ok(worker.indexOf('globalThis.fetch=')<worker.indexOf('runtime??=import('));
 assert.match(worker,/TEST_ESCROW_FORBIDDEN/);assert.match(journey,/fetch\(localTarget\(target\)/);assert.match(journey,/'--local'/);
 assert.match(journey,/method:'POST',redirect:'error'/);assert.match(journey,/LOOPBACK_ONLY/);assert.match(journey,/serviceWorkers:'block'/);
 assert.match(readFileSync('scripts/ci.mjs','utf8'),/"browser-e2e":[^\n]+cloudflare\/test\/agent-journey\.mjs/);
});
