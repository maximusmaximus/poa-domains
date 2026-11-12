// Public snapshots only: no bootstrap, private keys, signatures, persistence or network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {Engine} from '../dist/src/engine.js';
import {mainnetConfig} from '../dist/src/config.js';
import {ManualClock} from '../dist/src/clock.js';
import {publicRegistryRoute,HIDDEN,AUDITED_REGISTRY,unavailableKey} from '../dist/public-registry-view.mjs';
import {publicNameUnavailable,registryUnit} from '../reference-web/shared.js';
import {original,auditedEngine,get} from './fixtures/audited-engine.mjs';
const collections=['names','deeds','auctions','offers','balances','credits','nonces','receipts','requests','bids'];
test('entire approved public inventory is hidden without mutating a byte of Engine state or identity',()=>{const e=auditedEngine(),before=e.snapshot(),data=get(e,'/v1/state').data;for(const k of collections)assert.deepEqual(data.state[k],{},k);assert.equal(data.state.sequence,16);assert.equal(data.stateHash,original.stateHash);assert.equal(data.publicView.stateHashScope,'complete-stored-state');assert.deepEqual(e.snapshot(),before);assert.equal(e.stateHash(),original.stateHash);assert.equal(get(e,'/healthz').data.principals,undefined);});
test('exact and alternate spellings, hidden ancestry, IDs and seeded account nonce never expose records or become free',()=>{const e=auditedEngine();for(const name of [...HIDDEN.names,'NEXUS','poa:nexus','👩🏿‍🦰','newchild.nexus','newchild.👩‍🦰'])for(const [path,query]of [['/v1/resolve',{name}],['/v1/quote',{name,action:'announceAuction'}],['/v1/names/'+encodeURIComponent(name),{}]]){const r=get(e,path,query);assert.equal(r.status,409,JSON.stringify({path,query,r}));assert.equal(r.data.code,'PUBLIC_RECORD_WITHHELD');assert.equal(r.data.accepted,false);assert.ok(!r.data.name&&!r.data.owner&&!r.data.deed);}
for(const [collection,ids]of Object.entries(HIDDEN).filter(([k])=>['deeds','auctions','offers','receipts'].includes(k)))for(const id of ids){if(collection==='deeds')continue;const r=get(e,'/v1/'+collection+'/'+id);assert.equal(r.status,409);assert.equal(r.data.code,'PUBLIC_RECORD_WITHHELD');assert.equal(r.data.accepted,collection==='receipts'?'unknown':false);assert.ok(!JSON.stringify(r.data).includes(id));}
for(const signer of HIDDEN.accounts)assert.equal(get(e,'/v1/nonce',{signer}).status,409);
for(const kind of ['auctions','offers'])assert.deepEqual(get(e,'/v1/'+kind,{limit:'1'}).data.items,[]);
assert.equal(e.stateHash(),original.stateHash);});
test('preview and submit guards run BEFORE Engine or escrow hooks, including old receipt replay and hidden IDs',()=>{const e=auditedEngine();let calls=0;e.preview=e.submit=()=>{calls++;throw Error('MUTATION_FORBIDDEN');};for(const path of ['/v1/intents','/v1/intents/preview'])for(const body of [{params:{name:'NEXUS'}},{params:{name:'👩🏿‍🦰'}},{params:{parent:'nexus'}},{params:{auctionId:HIDDEN.auctions[0]}},{signer:HIDDEN.accounts[0]},{requestId:HIDDEN.requests[15]}]){const r=publicRegistryRoute(e,{method:'POST',path,query:{},packet:JSON.stringify({body})},{beforeSubmit:()=>{calls++;}});assert.equal(r.status,409);}assert.equal(calls,0);assert.equal(e.stateHash(),original.stateHash);});
test('unit policy, not wallet money; opaque UI hints agree for every hidden name and emoji class',()=>{const e=auditedEngine(),cap=get(e,'/v1/capabilities',{include:'emoji'}).data;assert.equal(cap.livePoA,false);assert.equal(cap.onboardingGrantPoa,undefined);assert.equal(cap.onboardingGrantRegistryUnits,'0');assert.equal(cap.registryUnits.nativePayment,false);assert.equal(cap.assets.POA.kind,'internal-registry-units');for(const name of [...HIDDEN.names,'👩🏿‍🦰','child.nexus','child.👩🏿‍🦰'])assert.equal(publicNameUnavailable(name,cap),true,name);assert.equal(publicNameUnavailable('newpublicname',cap),false);assert.equal(registryUnit('POA'),'registry units');assert.equal(registryUnit('TEST'),'TEST registry units');assert.equal(unavailableKey('test'),unavailableKey('test'));assert.equal(e.stateHash(),original.stateHash);});
test('new unrelated public records remain visible and pagination omits hidden-ID cursors',()=>{const e=auditedEngine();for(const id of ['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)])e.state.auctions[id]={id,name:'newpublicname',status:'live',reserve:'1000',asset:'POA'};e.state.names.newpublicname={auctionId:'a'.repeat(64)};const s=get(e,'/v1/state').data.state;assert.deepEqual(Object.keys(s.auctions),['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]);assert.deepEqual(Object.keys(s.names),['newpublicname']);let cursor,all=[];do{const p=get(e,'/v1/auctions',{limit:'1',...(cursor?{cursor}:{})});assert.equal(p.status,200);all.push(...p.data.items.map(x=>x.id));cursor=p.data.nextCursor;}while(cursor);assert.deepEqual(all,Object.keys(s.auctions));});

test('scanner exception is restricted to six reproducible public name IDs, not a file or rule bypass',async()=>{
 const {nameKey}=await import('../dist/src/names.js');
 const config=readFileSync('.gitleaks.toml','utf8'),section=config.split('[[allowlists]]')[2];
 assert.match(section,/targetRules = \["generic-api-key"\]/);assert.match(section,/condition = "AND"/);assert.ok(section.includes("(^|/)test/fixtures/public-view-state\\.json$"));
 const values=section.match(/regexes = \['''\^\(([^)]+)\)\$'''\]/)[1].split('|');
 assert.deepEqual(values,HIDDEN.names.map(n=>nameKey(AUDITED_REGISTRY,n,'emoji17-full')));assert.equal(values.length,6);
});
