import test from "node:test";
import assert from "node:assert/strict";
import {setup,lease,witness} from "./helpers.js";
import {PRACTICE_POLICY,Engine} from "../src/engine.js";
import {ACTIONS} from "../src/actions.js";
import {mainnetConfig} from "../src/config.js";
import {ManualClock} from "../src/clock.js";
import {quote,readPage,readName,readAuction,readOffer} from "../src/registry-reads.js";
import {capabilities,prepare} from "../src/interface.js";
import {registryRoute} from "../src/registry-routes.js";
import {nativePrincipal,intentId,signBody} from "../src/auth.js";

const exercised=new Set<string>();
function submitQuote(t:ReturnType<typeof setup>,action:string,name:string,input:Record<string,any>={},who=t.alice,co:typeof t.alice[]=[]) {
  const q=quote(t.e,{name,action,signer:who.id,...(input.offerId?{offerId:input.offerId}:{}),...(input.auctionId?{auctionId:input.auctionId}:{})});
  const params={...q.params,...input};
  for(const key of q.requiredInputs)assert.ok(Object.hasOwn(input,key),key);
  const packet=t.packet(action,params,who,{maxTotal:q.requiredMaxTotal??params.amount},co);
  const state=t.e.snapshot(),hash=t.e.stateHash(),nonce=t.e.nextNonce(who.id);
  const preview=JSON.parse(registryRoute(t.e,{method:"POST",path:"/v1/intents/preview",query:{},packet:JSON.stringify(packet)}).jsonText);
  assert.equal(preview.accepted,false);assert.equal(preview.committed,false);assert.equal(preview.previewOnly,true);
  assert.deepEqual(t.e.snapshot(),state);assert.equal(t.e.stateHash(),hash);assert.equal(t.e.nextNonce(who.id),nonce);
  assert.equal(t.e.receipt(intentId(packet.body)),null);
  assert.equal(preview.wouldSucceed,true,`${action}: ${preview.receipt.code}`);
  const actual=t.e.submit(packet);assert.deepEqual(actual,preview.receipt);assert.equal(actual.status,"succeeded");
  exercised.add(action);return {q,receipt:actual};
}
test("quoted params and gross caps match actual signed submissions for every admitted action",()=>{
  {
    const t=setup();const {q,receipt}=submitQuote(t,"announceAuction","quotes",{},t.issuer);
    assert.equal(q.reserve,t.config.assets.POA!.standardReserve);assert.equal(q.expectedVersion,0);
    const id=receipt.result.auctionId,a=t.e.snapshot().auctions[id]!;t.clock.set(a.openAt);
    const first=submitQuote(t,"bid","quotes",{auctionId:id});assert.equal(first.q.requiredMaxTotal,a.reserve);
    const second=submitQuote(t,"bid","quotes",{auctionId:id},t.bob);assert.equal(second.q.minimumNextBid,"111");
    assert.equal(second.q.fee,"1");assert.equal(second.q.requiredMaxTotal,"111");assert.equal(second.q.feeChargedNow,false);
    submitQuote(t,"withdrawRefund","quotes",{auctionId:id},t.alice);
    t.clock.set(t.e.closeEligible(t.e.snapshot().auctions[id]!));
    const final=submitQuote(t,"finalize","quotes",{auctionId:id},t.carol);assert.equal(final.q.fee,"1");assert.equal(final.q.requiredMaxTotal,"0");
  }
  for(const action of ["cancelAuction","closeNoBid"]) {
    const t=setup();const id=t.announce("nobids");if(action==="closeNoBid")t.clock.set(t.e.closeEligible(t.e.snapshot().auctions[id]!));
    submitQuote(t,action,"nobids",{auctionId:id},t.issuer);
  }
  {
    const t=setup();t.win();
    const {receipt}=submitQuote(t,"createChildOffer","alpha",{price:"200",validUntil:t.clock.now()+86400,labels:["agent"],maxUses:2});
    const id=receipt.result.offerId;
    const fill=submitQuote(t,"fillChildOffer","agent.alpha",{offerId:id},t.bob);
    assert.equal(fill.q.price,"200");assert.equal(fill.q.fee,"2");assert.equal(fill.q.requiredMaxTotal,"200");
    submitQuote(t,"revokeChild","agent.alpha",{},t.bob,[t.alice]);
    // Revocation changes the parent's encumbrance; cancellation itself remains valid.
    submitQuote(t,"cancelOffer","alpha",{offerId:id});
    submitQuote(t,"setRecords","alpha",{records:[{type:"service",url:"https://example.com/"}]});
    submitQuote(t,"setMetadata","alpha",{metadata:witness("alpha",{kind:"permanent"},null,"A new description")});
    const sell=submitQuote(t,"sellFixed","alpha",{price:"350",validUntil:t.clock.now()+86400});
    const buy=submitQuote(t,"buyFixed","alpha",{offerId:sell.receipt.result.offerId},t.bob);
    assert.equal(buy.q.fee,"3");assert.equal(buy.q.requiredMaxTotal,"350");
    submitQuote(t,"transfer","alpha",{recipient:t.carol.id},t.bob);
  }
  {
    const t=setup();t.win();const id=t.offer(lease(t.clock.now()));assert.equal(t.fill(id).status,"succeeded");
    const d=t.deed("agent.alpha");t.clock.set(d.expiry!-500);
    const renew=submitQuote(t,"renewLease","agent.alpha",{},t.bob);assert.equal(renew.q.price,"50");
    t.clock.set(t.deed("agent.alpha").expiry!+100);submitQuote(t,"expireLease","agent.alpha",{},t.carol);
  }
  assert.deepEqual([...exercised].sort(),Object.keys(ACTIONS).sort());
});

test("preview failures do not touch balances, nonce, sequence, receipts, journal or read-only admission",()=>{
  const t=setup(),id=t.announce("preview"),a=t.e.snapshot().auctions[id]!;t.clock.set(a.openAt);
  assert.equal(t.send("bid",{auctionId:id,expectedVersion:a.version,asset:"POA",amount:"100",beneficiary:t.bob.id},t.bob).status,"succeeded");
  const current=t.e.snapshot().auctions[id]!;
  let appends=0;t.e.attach({append(){appends++;},close(){}});
  for(const [amount,maxTotal,version,code] of [["100","111",current.version,"MIN_RAISE"],["111","110",current.version,"AMOUNT_CAP"],["111","111",99,"STALE_VERSION"]] as const) {
    const packet=t.packet("bid",{auctionId:id,expectedVersion:version,asset:"POA",amount,beneficiary:t.alice.id},t.alice,{maxTotal});
    const before=t.e.snapshot(),result=JSON.parse(registryRoute(t.e,{method:"POST",path:"/v1/intents/preview",query:{},packet:JSON.stringify(packet)}).jsonText);
    assert.equal(result.wouldSucceed,false);assert.equal(result.receipt.code,code);assert.equal(result.receipt.accepted,false);
    assert.deepEqual(t.e.snapshot(),before);assert.equal(appends,0);
  }
  const packet=t.packet("bid",{auctionId:id,expectedVersion:current.version,asset:"POA",amount:"111",beneficiary:t.alice.id});
  const beforeSuccess=t.e.snapshot();
  const successful=JSON.parse(registryRoute(t.e,{method:"POST",path:"/v1/intents/preview",query:{},packet:JSON.stringify(packet)}).jsonText);
  assert.equal(successful.wouldSucceed,true);assert.equal(appends,0);assert.deepEqual(t.e.snapshot(),beforeSuccess);
  assert.throws(()=>registryRoute(t.e,{method:"POST",path:"/v1/intents/preview",query:{},packet:JSON.stringify(packet)},{beforeSubmit(){throw Error("TITLE_RESERVED");}}),/TITLE_RESERVED/);
  assert.equal(appends,0);
});

test("permanent-only policy is never re-enabled by quoting or previewing leases",()=>{
  const t=setup(undefined,PRACTICE_POLICY);
  for(const action of ["renewLease","expireLease"]) {
    assert.throws(()=>quote(t.e,{name:"alpha",action}),/PERMANENT_OWNERSHIP_ONLY/);
    const p=t.packet(action,{name:"alpha",expectedDeedId:"0".repeat(64),expectedVersion:1});
    assert.throws(()=>registryRoute(t.e,{method:"POST",path:"/v1/intents/preview",query:{},packet:JSON.stringify(p)}),/PERMANENT_OWNERSHIP_ONLY/);
  }
  assert.equal(t.e.snapshot().sequence,0);
});

test("targeted reads and stable bounded pages never mutate state and reject stale/foreign cursors",()=>{
  const t=setup();t.win();const first=t.offer();t.offer({kind:"permanent"},["other"]);t.announce("bravo");t.announce("charlie");
  const before=t.e.snapshot(),stateHash=t.e.stateHash();
  assert.equal(readName(t.e,"poa:ALPHA").deed!.id,t.deed("alpha").id);
  assert.equal(readOffer(t.e,first).parentDeed!.name,"alpha");
  assert.equal(readAuction(t.e,Object.keys(before.auctions)[0]!).auction.name,"alpha");
  for(const kind of ["auctions","offers"] as const) {
    const ids:string[]=[];let cursor:string|null=null;
    do {const page=readPage(t.e,kind,{limit:"1",...(cursor?{cursor}:{})});assert.equal(page.items.length,1);ids.push(page.items[0]!.id);cursor=page.nextCursor;}while(cursor);
    assert.deepEqual(ids,Object.keys(before[kind]).sort());assert.equal(new Set(ids).size,ids.length);
    assert.equal(readPage(t.e,kind,{}).limit,50);assert.equal(readPage(t.e,kind,{limit:"100"}).nextCursor,null);
    for(const limit of ["0","101","-1","1.0","01","1e2","x",""])assert.throws(()=>readPage(t.e,kind,{limit}),/PAGE_LIMIT/);
    for(const cursor of ["", "bad", "x".repeat(4096)])assert.throws(()=>readPage(t.e,kind,{cursor}),/PAGE_CURSOR/);
  }
  assert.deepEqual(t.e.snapshot(),before);assert.equal(t.e.stateHash(),stateHash);
  const page=readPage(t.e,"auctions",{limit:"1"});assert.throws(()=>readPage(t.e,"offers",{cursor:page.nextCursor!}),/PAGE_CURSOR/);
  t.announce("freshcursor");assert.throws(()=>readPage(t.e,"auctions",{cursor:page.nextCursor!}),/STALE_CURSOR/);
  assert.throws(()=>readAuction(t.e,"bad"),/RESOURCE_ID/);assert.throws(()=>readOffer(t.e,"0".repeat(64)),/RESOURCE_NOT_FOUND/);
  assert.throws(()=>readName(t.e,"%FF"),/NAME/);assert.throws(()=>readName(t.e,"missing"),/NOT_FOUND/);
});

test("quotes expose conflicts and seller choices without guessing; ambiguity and stale offers fail closed",()=>{
  const t=setup();t.win();const id=t.offer();t.offer();
  assert.throws(()=>quote(t.e,{name:"agent.alpha",action:"fillChildOffer"}),/QUOTE_AMBIGUOUS/);
  const q=quote(t.e,{name:"agent.alpha",action:"fillChildOffer",offerId:id});assert.equal(q.expectedVersion,1);
  assert.throws(()=>quote(t.e,{name:"other.alpha",action:"fillChildOffer",offerId:id}),/LABEL_NOT_OFFERED/);
  const sale=quote(t.e,{name:"alpha",action:"sellFixed"});assert.deepEqual(sale.requiredInputs,["price","validUntil"]);assert.equal(sale.params!.price,null);assert.equal(sale.requiredMaxTotal,"0");
  const announce=quote(t.e,{name:"alpha",action:"announceAuction"});assert.equal(announce.params!.reserve,null);assert.deepEqual(announce.requiredInputs,["reserve"]);
  t.send("transfer",{...t.vp("alpha"),recipient:t.carol.id});
  assert.throws(()=>quote(t.e,{name:"agent.alpha",action:"fillChildOffer",offerId:id}),/STALE_OFFER/);
  assert.throws(()=>quote(t.e,{name:"free",action:"doesNotExist"}),/UNSUPPORTED_ACTION/);
  const e=new Engine(mainnetConfig(nativePrincipal(t.issuer.key),nativePrincipal(t.treasury.key)),new ManualClock(1000000));
  // Mainnet manifests are large; default HTTP capabilities omit only the two data tables.
  const slim=JSON.parse(registryRoute(e,{method:"GET",path:"/v1/capabilities",query:{}}).jsonText);
  const full=JSON.parse(registryRoute(e,{method:"GET",path:"/v1/capabilities",query:{include:"emoji"}}).jsonText);
  assert.equal(slim.emojiManifest,undefined);assert.equal(slim.emojiOwnership.multiMemberClasses,undefined);
  assert.ok(Object.keys(full.emojiManifest.sequences).length===5216);assert.ok(full.emojiOwnership.multiMemberClasses.length>0);
  assert.equal(slim.normalizationHash,full.normalizationHash);assert.deepEqual(slim.assets,full.assets);
  assert.ok(JSON.stringify(slim).length<JSON.stringify(full).length/10);
});


test("earliest-policy quote has no absolute clock race; explicit schedules and integer/delay guards remain strict", () => {
  for (const mainnet of [false,true]) {
    const t=setup();
    const who=mainnet?nativePrincipal(t.issuer.key):t.issuer.id;
    const e=mainnet?new Engine(mainnetConfig(who,nativePrincipal(t.treasury.key)),t.clock):t.e;
    const q=quote(e,{name:"clockpolicy",action:"announceAuction",signer:who});
    assert.ok(q.params);assert.equal(q.params.openAt,0);
    t.clock.advance(1);
    const body=prepare({signer:who,coSigners:[],requestId:"clock-initial",nonce:0,notBefore:0,deadline:t.clock.now()+300000,maxTotal:"10000000",maxNetworkFee:"0",action:"announceAuction",params:q.params},capabilities(e));
    const packet=signBody(body,[t.issuer.key]);
    const result=e.submit(packet);assert.equal(result.status,"succeeded");
    const auction=e.snapshot().auctions[result.result.auctionId]!;
    assert.equal(auction.openAt,t.clock.now()+(mainnet?0:86400),"reference policy still requires a full day at execution");
    const snap=e.snapshot();assert.deepEqual(e.submit(packet),result);assert.deepEqual(e.snapshot(),snap,"same signed packet replays without moving start");
    for(const openAt of [-1,0.5,"0",t.clock.now()-1]) {
      const next=quote(e,{name:"invalidschedule",action:"announceAuction",signer:who});
      const invalid={...body,nonce:e.nextNonce(who),requestId:"invalid-clock-"+String(openAt),params:{...next.params,openAt}};
      if(typeof openAt==="number"&&(openAt<0||!Number.isInteger(openAt)))assert.throws(()=>signBody(invalid,[t.issuer.key]),/INTEGER/);
      else assert.equal(e.submit(signBody(invalid,[t.issuer.key])).code,"INTEGER");
    }
    const next=quote(e,{name:"scheduled",action:"announceAuction",signer:who});
    const future=t.clock.now()+86400+600;
    const scheduled=signBody({...body,nonce:e.nextNonce(who),requestId:"explicit-future-clock",params:{...next.params,openAt:future}},[t.issuer.key]);
    const accepted=e.submit(scheduled);assert.equal(accepted.status,"succeeded");assert.equal(e.snapshot().auctions[accepted.result.auctionId]!.openAt,future);
  }
});
