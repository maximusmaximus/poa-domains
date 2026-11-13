import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync,openSync,closeSync,readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const root=resolve(import.meta.dirname,"../.."),work=mkdtempSync(join(tmpdir(),"poa-escrow-e2e-"));
const port=Number(process.env.ESCROW_TEST_PORT??18972),url=`http://127.0.0.1:${port}`;
let server,count=0;
let instance="";
const call=async(v,expected=200)=>{const r=await fetch(url+instance,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(v),signal:AbortSignal.timeout(30000)});const b=await r.json();assert.equal(r.status,expected,JSON.stringify(b));return b;};
function check(name,fn){fn();count++;console.log(`PASS ${name}`);}
async function start(label){const fd=openSync(join(work,label+".log"),"w",0o600);
 server=spawn(process.execPath,["node_modules/wrangler/bin/wrangler.js","dev","--local","--config","cloudflare/test/escrow.wrangler.jsonc","--ip","127.0.0.1","--port",String(port),"--persist-to",join(work,"state")],
 {cwd:root,detached:true,stdio:["ignore",fd,fd],env:{...process.env,WRANGLER_SEND_METRICS:"false"}});closeSync(fd);
 for(let i=0;i<180;i++){if(server.exitCode!==null)throw Error(readFileSync(join(work,label+".log"),"utf8"));
 try{const r=await fetch(url,{method:"POST",body:'{"op":"status"}',signal:AbortSignal.timeout(2000)});if(r.status===200)return await r.json();}catch{}await delay(100);}
 throw Error("LOCAL_WORKER_START_TIMEOUT "+work);
}
async function stop(hard=false){if(!server||server.exitCode!==null)return;const done=once(server,"exit");process.kill(-server.pid,hard?"SIGKILL":"SIGTERM");await Promise.race([done,delay(10000)]);if(server.exitCode===null)process.kill(-server.pid,"SIGKILL");}
const cmd=(actor,key,action,params)=>call({op:"command",actor,key,action,params});
try{
 const first=await start("first");check("real workerd + SQLite initializes actual registry",()=>assert.equal(first.engineSequence,15));await call({op:"unpause"});
 const intent=await cmd(3,"intent","intent",{amount:"110000.000000"}),id=intent.result.intent;
 await call({op:"fund",actor:3,amount:"110000.000000",intent:id});
 // tx ID is available in the mock's durable ledger via deterministic fixture build, bundled below.
 const {txid,depositBody,policy,who}=await import(process.env.ESCROW_FIXTURE_MODULE);
 const tx=txid(depositBody(3,policy.wallet,"110000.000000",id));
 const deposit=await cmd(3,"detect","detect",{intent:id,txid:tx});check("verified deposit credits actual SQLite escrow ledger",()=>assert.equal(deposit.state.assets,"110000000000"));
 await call({op:"command",actor:4,key:"steal",action:"detect",params:{intent:id,txid:tx}},409);count++;
 const opened=await cmd(2,"open","open",{name:"👩‍🦰",reserve:"100000.000000"}),auction=opened.result.auction;
 const locked=await call({op:"normal-write",packet:{}},409);check("reserved title prevents ordinary registry writes",()=>assert.equal(locked.code,"ESCROW_TITLE_RESERVED"));
 await cmd(3,"bid","bid",{auction,amount:"100000.000000"});
 const before=await call({op:"status"});await stop();const after=await start("deposit-restart");
 check("full process restart replays deposit, bid hold, title and journal exactly",()=>assert.deepEqual(after,before));
 await call({op:"stale",value:true});const held=await call({op:"tick"},409);check("stale network prohibits signing/payout",()=>assert.equal(held.code,"ESCROW_STALE"));await call({op:"stale",value:false});
 await call({op:"advance",ms:86400001});const consent=await call({op:"consent"});
 await cmd(2,"settle","settle",{auction,transfer:consent.packet});await call({op:"mode",mode:"after-timeout"});
 await call({op:"tick"});await call({op:"arm",point:"after-payout"});const crashed=await call({op:"tick"},409);check("crash after external payout before title commit is injected",()=>assert.equal(crashed.code,"TEST_CRASH"));
 const paid=await call({op:"status"});check("payout final while title remains reserved for seller",()=>{assert.equal(paid.owner,who(2));assert.equal(paid.calls,1);});
 await stop(true);await start("payout-restart");
 for(let i=0;i<5;i++)await call({op:"tick"});
 const completed=await call({op:"status"});check("restart recovers seller payout, fee and actual permanent-name transfer",()=>{assert.equal(completed.owner,who(3));assert.equal(completed.calls,2);assert.equal(completed.state.settlements[auction].status,"COMPLETE");assert.equal(completed.engineSequence,16);});
 check("sequential outgoing nonces and fee split match actual registry policy",()=>{assert.deepEqual(completed.submissions.map(x=>x.nonce),[1,2]);assert.deepEqual(completed.submissions.map(x=>x.amount),["97500.000000","2500.000000"]);});
 await Promise.all(Array.from({length:12},()=>call({op:"tick"})));const duplicate=await call({op:"status"});check("concurrent recovery cannot repay or repeat title transfer",()=>{assert.equal(duplicate.calls,2);assert.equal(duplicate.engineSequence,16);});
 await cmd(3,"withdraw","withdraw",{amount:"10000.000000"});await call({op:"pause"});await call({op:"tick"},409);count++;
 await call({op:"unpause"});await call({op:"tick"});await call({op:"tick"});const refunded=await call({op:"status"});check("remaining deposit refund pays original payer once",()=>{assert.equal(refunded.calls,3);assert.equal(refunded.submissions[2].to,who(3));assert.equal(refunded.state.assets,"0");});
 await stop();const final=await start("complete-restart");check("completed name title, refunds and idempotency survive full restart",()=>assert.deepEqual(final,refunded));
 // POA new-name checkout: deposit -> credit -> issue from treasury, on the real Engine + SQLite registry journal.
 instance="?instance=isolated-new-name-checkout";await call({op:"unpause"});
 const buyIntent=await cmd(4,"issue-intent","intent",{amount:"150.000000"});const funded=await call({op:"fund",actor:4,amount:"150.000000",intent:buyIntent.result.intent});
 await cmd(4,"issue-detect","detect",{intent:buyIntent.result.intent,txid:funded.txid});
 const quote=await call({op:"issue-packet",name:"freshname",buyer:4});const price=(Number(quote.price)/1e6).toFixed(6);
 const off=await call({op:"command",actor:4,key:"issue-off",action:"issue",params:{name:"freshname",amount:price,registration:quote.packet}},409);
 check("checkout OFF by default: issue refused before any debit or registry write",()=>assert.equal(off.code,"ESCROW_NEW_NAMES_OFF"));
 const unchanged=await call({op:"name-owner",name:"freshname"});check("OFF leaves the name unissued and the credit intact",()=>{assert.equal(unchanged.nameOwner,null);assert.equal(unchanged.state.available[who(4)],"150000000");});
 const direct=await call({op:"normal-write",packet:quote.packet},409);check("public registry submit of issueFromTreasury is refused (escrow only)",()=>assert.equal(direct.code,"ESCROW_ONLY"));
 await call({op:"new-names",value:true});
 const wrong=await call({op:"command",actor:4,key:"issue-wrong",action:"issue",params:{name:"freshname",amount:"0.500000",registration:quote.packet}},409);
 check("price must equal the POA checkout schedule",()=>assert.equal(wrong.code,"ESCROW_PRICE"));
 const thief=await call({op:"command",actor:3,key:"issue-thief",action:"issue",params:{name:"freshname",amount:price,registration:quote.packet}},409);
 check("another payer cannot use the buyer's signed registration",()=>assert.ok(["ESCROW_ISSUE_CONSENT","ESCROW_INSUFFICIENT_FUNDS"].includes(thief.code)));
 const bought=await cmd(4,"issue-ok","issue",{name:"freshname",amount:price,registration:quote.packet});
 const owner=await call({op:"name-owner",name:"freshname"});
 check("issue mints the permanent name to the buyer and debits exactly the price",()=>{assert.equal(owner.nameOwner,who(4));assert.equal(owner.state.available[who(4)],String(150000000n-BigInt(quote.price)));assert.equal(bought.result.price,price);});
 check("proceeds are a READY treasury payout liability, accounting invariant holds",()=>{const pay=owner.state.payments[bought.result.payment];assert.equal(pay.to,who(5));assert.equal(pay.amount,quote.price);assert.equal(pay.status,"READY");});
 const again=await cmd(4,"issue-ok","issue",{name:"freshname",amount:price,registration:quote.packet});check("same request key is idempotent, never a second debit",()=>assert.deepEqual(again.result,bought.result));
 const quote2=await call({op:"issue-packet",name:"freshname",buyer:4});const taken=await call({op:"command",actor:4,key:"issue-again",action:"issue",params:{name:"freshname",amount:price,registration:quote2.packet}},409);
 check("an issued name cannot be issued twice",()=>assert.equal(taken.code,"ESCROW_NAME_TAKEN"));
 const beforeIssueRestart=await call({op:"name-owner",name:"freshname"});await stop();await start("issue-restart");await call({op:"new-names",value:true});
 const afterIssueRestart=await call({op:"name-owner",name:"freshname"});
 check("full restart replays the issueFromTreasury commit and escrow ledger exactly",()=>assert.deepEqual(afterIssueRestart,beforeIssueRestart));
 await call({op:"tick"});await call({op:"tick"});const paidOut=await call({op:"status"});
 check("treasury proceeds pay out through the existing outbox",()=>assert.ok(paidOut.submissions.some(x=>x.to===who(5)&&x.amount===price)));
 await cmd(4,"issue-withdraw","withdraw",{amount:(Number(150000000n-BigInt(quote.price))/1e6).toFixed(6)});await call({op:"tick"});await call({op:"tick"});
 const refundedBuyer=await call({op:"status"});check("remaining credit refunds only to the original payer",()=>assert.ok(refundedBuyer.submissions.some(x=>x.to===who(4))));
 instance="";
 const archived=await call({op:"archive"});instance="?instance=isolated-archive-restore";
 const restored=await call({op:"restore-archive",archive:archived.archive});
 check("actual SQLite escrow archive restore preserves money journal, forces pause, and sets read-only halt",()=>{assert.equal(restored.state.assets,"0");assert.equal(restored.state.paused,true);assert.equal(restored.state.halt,"RESTORED_ARCHIVE_READ_ONLY");assert.equal(restored.state.sequence,archived.state.sequence+1);assert.deepEqual(restored.state.payments,archived.state.payments);});
 await call({op:"unpause"});
 const noReplay=await call({op:"tick"},409);
 check("restored archive cannot replay payouts even if unpaused",()=>assert.equal(noReplay.code,"ESCROW_HALTED"));
 await call({op:"pause"});
 const afterUnpauseAttempt=await call({op:"status"});
 const tampered=structuredClone(archived.archive);tampered.rows[0].state.assets="1";
 await call({op:"restore-archive",archive:tampered},409);count++;
 const afterBad=await call({op:"status"});
 check("failed archive validation leaves isolated restored ledger unchanged",()=>assert.deepEqual(afterBad.state,afterUnpauseAttempt.state));
 console.log(`SUMMARY ${count} PASS, 0 FAIL; real local workerd/SQLite + mock chain (no mainnet writes)`);
}finally{await stop();console.log("Local test evidence: "+work);}
