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
test('entire approved public inventory is hidden without mutating a byte of Engine state or identity',()=>{const e=auditedEngine(),before=e.snapshot(),data=get(e,'/v1/state').data;for(const k of collections)assert.deepEqual(data.state[k],{},k);assert.deepEqual(data.history,[]);assert.equal(data.state.sequence,16);assert.equal(data.stateHash,original.stateHash);assert.equal(data.publicView.stateHashScope,'complete-stored-state');assert.deepEqual(e.snapshot(),before);assert.equal(e.stateHash(),original.stateHash);assert.equal(get(e,'/healthz').data.principals,undefined);});
test('exact and alternate spellings, hidden ancestry, IDs and seeded account nonce never expose records or become free',()=>{const e=auditedEngine();for(const name of [...HIDDEN.names,'NEXUS','poa:nexus','👩🏿‍🦰','newchild.nexus','newchild.👩‍🦰'])for(const [path,query]of [['/v1/resolve',{name}],['/v1/quote',{name,action:'announceAuction'}],['/v1/names/'+encodeURIComponent(name),{}]]){const r=get(e,path,query);assert.equal(r.status,409,JSON.stringify({path,query,r}));assert.equal(r.data.code,'PUBLIC_RECORD_WITHHELD');assert.equal(r.data.accepted,false);assert.ok(!r.data.name&&!r.data.owner&&!r.data.deed);}
for(const [collection,ids]of Object.entries(HIDDEN).filter(([k])=>['deeds','auctions','offers','receipts'].includes(k)))for(const id of ids){if(collection==='deeds')continue;const r=get(e,'/v1/'+collection+'/'+id);assert.equal(r.status,409);assert.equal(r.data.code,'PUBLIC_RECORD_WITHHELD');assert.equal(r.data.accepted,collection==='receipts'?'unknown':false);assert.ok(!JSON.stringify(r.data).includes(id));}
for(const signer of HIDDEN.accounts)assert.equal(get(e,'/v1/nonce',{signer}).status,409);
for(const kind of ['auctions','offers'])assert.deepEqual(get(e,'/v1/'+kind,{limit:'1'}).data.items,[]);
assert.equal(e.stateHash(),original.stateHash);});
test('preview and submit guards run BEFORE Engine or escrow hooks, including old receipt replay and hidden IDs',()=>{const e=auditedEngine();let calls=0;e.preview=e.submit=()=>{calls++;throw Error('MUTATION_FORBIDDEN');};for(const path of ['/v1/intents','/v1/intents/preview'])for(const body of [{params:{name:'NEXUS'}},{params:{name:'👩🏿‍🦰'}},{params:{parent:'nexus'}},{params:{auctionId:HIDDEN.auctions[0]}},{signer:HIDDEN.accounts[0]},{requestId:HIDDEN.requests[15]}]){const r=publicRegistryRoute(e,{method:'POST',path,query:{},packet:JSON.stringify({body})},{beforeSubmit:()=>{calls++;}});assert.equal(r.status,409);}assert.equal(calls,0);assert.equal(e.stateHash(),original.stateHash);});
test('unit policy, not wallet money; opaque UI hints agree for every hidden name and emoji class',()=>{const e=auditedEngine(),cap=get(e,'/v1/capabilities',{include:'emoji'}).data;assert.equal(cap.livePoA,false);assert.equal(cap.newAccountRegistryUnits,undefined);assert.equal(cap.onboardingGrantRegistryUnits,undefined);assert.equal(cap.onboardingGrantPoa,undefined);assert.equal(cap.publicView.policy,'audited-withheld-records-v1');assert.equal(cap.registryUnits,undefined);assert.equal(cap.pricing.currency,'POA');assert.equal(cap.poaOnly.status,'on');assert.equal(cap.assets.POA.kind,'poa');assert.equal(cap.assets.POA.standardReserve,undefined);assert.ok(!/internal registry|internal-registry|internal units|registry units/.test(JSON.stringify({...cap,reservedCatalog:''})));for(const name of [...HIDDEN.names,'👩🏿‍🦰','child.nexus','child.👩🏿‍🦰'])assert.equal(publicNameUnavailable(name,cap),true,name);assert.equal(publicNameUnavailable('newpublicname',cap),false);assert.equal(registryUnit('POA'),'registry units');assert.equal(registryUnit('TEST'),'TEST registry units');assert.equal(unavailableKey('test'),unavailableKey('test'));assert.equal(e.stateHash(),original.stateHash);});
test('new unrelated public records remain visible and pagination omits hidden-ID cursors',()=>{const e=auditedEngine();for(const id of ['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)])e.state.auctions[id]={id,name:'newpublicname',status:'live',reserve:'1000',asset:'POA'};e.state.names.newpublicname={auctionId:'a'.repeat(64)};const s=get(e,'/v1/state').data.state;assert.deepEqual(Object.keys(s.auctions),['a'.repeat(64),'b'.repeat(64),'c'.repeat(64)]);assert.deepEqual(Object.keys(s.names),['newpublicname']);let cursor,all=[];do{const p=get(e,'/v1/auctions',{limit:'1',...(cursor?{cursor}:{})});assert.equal(p.status,200);all.push(...p.data.items.map(x=>x.id));cursor=p.data.nextCursor;}while(cursor);assert.deepEqual(all,Object.keys(s.auctions));});

test('scanner exception is restricted to six reproducible public name IDs, not a file or rule bypass',async()=>{
 const {nameKey}=await import('../dist/src/names.js');
 const config=readFileSync('.gitleaks.toml','utf8'),section=config.split('[[allowlists]]')[2];
 assert.match(section,/targetRules = \["generic-api-key"\]/);assert.match(section,/condition = "AND"/);assert.ok(section.includes("(^|/)test/fixtures/public-view-state\\.json$"));
 const values=section.match(/regexes = \['''\^\(([^)]+)\)\$'''\]/)[1].split('|');
 assert.deepEqual(values,HIDDEN.names.map(n=>nameKey(AUDITED_REGISTRY,n,'emoji17-full')));assert.equal(values.length,6);
});

test('Engine derives accurate per-domain commit history without altering stateHash and exposes it on /v1/state and /v1/names/:name',async()=>{
 const {generateKeyPairSync}=await import('node:crypto');
 const {nativePrincipal,signBody}=await import('../dist/src/auth.js');
 const {buildMetadataWitness}=await import('../dist/src/interface.js');
 const {buildProfileWitness}=await import('../dist/src/profile.js');
 const {poaNewNamePriceMicros}=await import('../dist/src/new-name-prices.js');
 const mk=()=>{const k=generateKeyPairSync('ed25519').privateKey;return {key:k,id:nativePrincipal(k)};};
 const issuer=mk(),treasury=mk(),alice=mk(),bob=mk();
 let now=1795762600;
 const eng=new Engine(mainnetConfig(issuer.id,treasury.id,[alice.id,bob.id]),{now:()=>now});
 const commits=[];
 eng.attach({append:(c)=>{commits.push(structuredClone(c));},close:()=>{}});
 const sign=(who,action,params,reqId)=>signBody({
  domain:'poa-domains.local.intent.v1',revision:eng.config.revision,chainId:eng.config.chainId,
  genesisHash:eng.config.genesisHash,registryId:eng.registryId,policyHash:eng.policyHash,normalizationHash:eng.config.normalizationHash,
  signer:who.id,coSigners:[],requestId:reqId,nonce:eng.nextNonce(who.id),notBefore:0,deadline:now+3600,
  maxTotal:'0',maxNetworkFee:'0',action,params,
 },[who.key]);
 // 1. Issue maxi via POA checkout
 const r1=eng.submitEscrowIssue(sign(alice,'issueFromTreasury',{name:'maxi',asset:'POA',price:poaNewNamePriceMicros('standard'),expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness('maxi')},'issue-maxi-1'));
 assert.equal(r1.status,'succeeded');
 // 2. Update profile metadata on maxi (avatar + bio + POA)
 now+=60;
 const d1=eng.snapshot().deeds[r1.result.deedId];
 const r2=eng.submit(sign(alice,'setMetadata',{name:'maxi',expectedDeedId:d1.id,expectedVersion:d1.version,metadata:buildProfileWitness({name:'maxi',rightsHash:d1.rightsHash,poa:alice.id,description:'Builder',image:'https://example.com/a.jpg'})},'meta-maxi-1'));
 assert.equal(r2.status,'succeeded');
 // 3. Set records on maxi
 now+=60;
 const d2=eng.snapshot().deeds[d1.id];
 const r3=eng.submit(sign(alice,'setRecords',{name:'maxi',expectedDeedId:d2.id,expectedVersion:d2.version,records:[{type:'service',url:'https://maxi.example'}]},'rec-maxi-1'));
 assert.equal(r3.status,'succeeded');
 // 4. Set & clear primary name on maxi
 now+=60;
 const d3=eng.snapshot().deeds[d1.id];
 assert.equal(eng.submit(sign(alice,'setPrimaryName',{name:'maxi',expectedDeedId:d3.id,expectedVersion:d3.version},'prim-set')).status,'succeeded');
 now+=60;
 assert.equal(eng.submit(sign(alice,'setPrimaryName',{name:null,expectedDeedId:null,expectedVersion:0},'prim-clear')).status,'succeeded');
 // 5. Issue subname under maxi
 now+=60;
 const d4=eng.snapshot().deeds[d1.id];
 const rSub=eng.submitEscrowIssue(sign(bob,'issueSubname',{name:'sub.maxi',parentDeedId:d4.id,parentOwnerVersion:d4.ownerVersion,asset:'POA',price:'50000000',expectedGeneration:1,metadata:buildMetadataWitness('sub.maxi',{kind:'permanent'},d4.id)},'sub-maxi-1'));
 assert.equal(rSub.status,'succeeded');
 // 6. Escrow settle transfer maxi -> bob
 now+=60;
 const d5=eng.snapshot().deeds[d1.id];
 const rSettle=eng.submitEscrowIssue(sign(treasury,'escrowSettle',{name:'maxi',expectedDeedId:d5.id,expectedVersion:d5.version,expectedOwnerVersion:d5.ownerVersion,seller:alice.id,recipient:bob.id,auctionId:'a'.repeat(64),price:'250000000'},'escrow-settle-1'));
 assert.equal(rSettle.status,'succeeded');

 const stateResp=get(eng,'/v1/state').data;
 const nameResp=get(eng,'/v1/names/maxi').data;
 const subResp=get(eng,'/v1/names/sub.maxi').data;
 assert.equal(stateResp.history.length,7);
 assert.equal(nameResp.history.length,7,'maxi history includes mint, profile, records, primary set/clear, subname mint, and escrow sale');
 assert.equal(subResp.history.length,1);
 assert.deepEqual(nameResp.history.map(h=>h.action),['issueFromTreasury','setMetadata','setRecords','setPrimaryName','setPrimaryName','issueSubname','escrowSettle']);
 assert.deepEqual(nameResp.history[1].profileFields,['avatar','bio','POA']);
 assert.equal(nameResp.history[1].metadataVersion,2);
 assert.equal(nameResp.history[2].recordsCount,1);
 assert.deepEqual(nameResp.history[2].recordTypes,['service']);
 assert.equal(nameResp.history[3].clearedPrimary,false);
 assert.equal(nameResp.history[4].clearedPrimary,true);
 assert.equal(nameResp.history[4].name,'maxi');
 assert.equal(nameResp.history[5].parent,'maxi');
 assert.equal(nameResp.history[6].actor,alice.id);
 assert.equal(nameResp.history[6].recipient,bob.id);
 assert.equal(nameResp.history[6].amount,'250000000');

 // Replaying commits from genesis reproduces byte-identical stateHash AND identical derived history!
 const replayed=new Engine(eng.config,{now:()=>now});
 for(const c of commits)replayed.replay(c);
 assert.equal(replayed.stateHash(),eng.stateHash());
 assert.deepEqual(replayed.history(),eng.history());
});
