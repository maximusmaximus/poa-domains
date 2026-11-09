// End-to-end tests against real local workerd + SQLite, including a full CLI restart.
// Private signing keys stay in this process's memory and are never written or logged.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, chmodSync, openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPairSync, randomBytes, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { nativePrincipal, signBody, intentId } from "../../dist/src/auth.js";
import { prepare, buildMetadataWitness } from "../../dist/src/interface.js";
import { browserSmoke } from "./browser.mjs";
import { EMOJI17_NORMALIZATION_HASH } from "../../dist/src/names.js";

const root = resolve(import.meta.dirname, "../..");
const ev = resolve(root, process.env.CF_TEST_EVIDENCE ?? "cloudflare/test/evidence"); mkdirSync(ev, { recursive: true });
const port = Number(process.env.CF_TEST_PORT ?? 18879), base = `http://127.0.0.1:${port}`;
const persist = process.env.CF_TEST_PERSIST ?? "./.local-cf-state";
const results = []; let server;
function check(name, fn) { try { fn(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, pass: false, error: e.message }); throw e; } }
const save = (name, value) => writeFileSync(resolve(ev, name), JSON.stringify(value, null, 2) + "\n");
async function api(path, init) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15000), redirect: "error", ...init });
  const body = await response.json(); return { status: response.status, body, headers: response.headers };
}
const post = packet => api("/v1/intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(packet) });
async function start(label) {
  mkdirSync(resolve(root,persist), {recursive:true,mode:0o700}); chmodSync(resolve(root,persist),0o700);
  const log = openSync(resolve(ev, `${label}.log`), "w", 0o600);
  server = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", persist],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error(`Wrangler exited ${server.exitCode}; inspect ${label}.log`);
    try { const h = await api("/healthz"); if (h.status === 200) return h.body; }
    catch { /* Bounded GET-only readiness probe, never retries a write. */ }
    await delay(100);
  }
  throw Error(`Wrangler readiness failed; inspect ${label}.log`);
}
async function stop() {
  if (!server) return;
  const child = server; server = undefined;
  if (child.exitCode !== null) return;
  const finished = once(child, "exit"); process.kill(-child.pid, "SIGTERM");
  let timer;
  try { await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Wrangler stop timeout")), 10000); })]); }
  catch (e) { try { process.kill(-child.pid, "SIGKILL"); } catch {} throw e; }
  finally { clearTimeout(timer); }
}
try {
  const first = await start("startup"); save("healthz-initial.json", first);
  if(process.env.CF_EXPECT_FRESH)check("fresh atomic bootstrap has exactly 15 seed commits",()=>assert.equal(first.sequence,15));
  check("healthz", () => { assert.equal(first.status, "ok"); assert.equal(first.processAlive, true); assert.equal(first.chainId, "poa-mainnet-1"); assert.equal(first.revision, "poa-mainnet-v1"); assert.equal(first.durability, "durable-object-sqlite"); });
  const cap = (await api("/v1/capabilities")).body; save("capabilities.json", cap);
  check("capabilities", () => {
    assert.equal(cap.emojiAliases, 5216); assert.equal(cap.reservedCount, 655);
    assert.equal(cap.assets.POA.premiumReserve, "100000"); assert.equal(cap.assets.POA.standardReserve, "1000");
    assert.equal(cap.onboardingGrantPoa, "10000000"); assert.equal(cap.publicExplorerUrl, "https://poadomains.grok.me");
    assert.equal(cap.githubMirrorUrl, "https://maximusmaximus.github.io/poa-domains/"); assert.equal(cap.chainId, "poa-mainnet-1");
    assert.equal(cap.revision, "poa-mainnet-v1"); assert.equal(cap.normalizationHash, EMOJI17_NORMALIZATION_HASH);
    assert.equal(Object.keys(cap.actions).length, 17); assert.equal(cap.durability, "durable-object-sqlite");
    assert.equal(cap.mode, "local-reference-only"); assert.equal(cap.livePoA, false);
  });
  const font = await fetch(base + "/XeroEmoji-COLRv1.woff2"), fontBytes = new Uint8Array(await font.arrayBuffer());
  check("font MIME and exact font bytes", () => { assert.equal(font.status, 200); assert.equal(font.headers.get("content-type"), "font/woff2"); assert.equal(createHash("sha256").update(fontBytes).digest("hex"), createHash("sha256").update(readFileSync(resolve(root,"reference-web/XeroEmoji-COLRv1.woff2"))).digest("hex")); });
  const home = await fetch(base + "/"), html = await home.text();
  check("home UI ids, six pills, ecosystem links and reference disclosure", () => {
    assert.equal(home.status, 200);
    for (const id of ["searchInput","searchBtn","cartList","cartPrompt","copyCartPrompt","stats","names","auctions","offers","history","balances","handoff"]) assert.ok(html.includes(`id="${id}"`), id);
    for (const link of ["https://poadomains.grok.me","https://maximusmaximus.github.io/poa-domains/","minepoa.com","https://poa.grok.me","xeroemoji","github.com/maximusmaximus/poa-domains"]) assert.ok(html.includes(link), link);
    const pills = html.match(/class="quick-pills"([\s\S]*?)<\/div>/)?.[0] ?? "";
    assert.equal((pills.match(/<button/g) ?? []).length,6); assert.ok(pills.includes("100k POA single emoji")); assert.ok(pills.includes("1k POA multi-emoji"));
    assert.match(html, /local reference\. Not live PoA/i);
    for (const id of ["siteTitle","liveTicker","floatingCartBtn","floatingCartPanel","copyCheckoutBtn","auctionsSection"]) assert.ok(html.includes(`id="${id}"`), id);
    assert.ok(home.headers.get("content-security-policy")); assert.equal(home.headers.get("x-content-type-options"),"nosniff");
  });
  for (const asset of ["/app.js","/shared.js","/style.css","/config.json","/icon.svg"]) { const status=(await fetch(base+asset)).status; check(`asset ${asset}`,()=>assert.equal(status,200)); }
  const initial = (await api("/v1/state")).body; save("state-initial.json", initial);
  check("seeded showcase domains, auctions, standing child offer, resale and records", () => {
    const s = initial.state;
    for (const name of ["👩‍🦰","🫪.👩‍🦰","nexus"]) assert.ok(s.names[name]?.activeId,name);
    for (const [name,reserve] of [["🌐","100000"],["🚀🚀","1000"]]) assert.ok(Object.values(s.auctions).some(a=>a.name===name&&a.reserve===reserve&&a.status==="live"),name);
    assert.ok(Object.values(s.offers).some(o=>o.kind==="child" && o.parentId===s.names.nexus.activeId&&o.labels===null&&!o.cancelled&&o.uses<o.maxUses));
    assert.ok(Object.values(s.offers).some(o=>o.kind==="resale"&&o.parentId===s.names["🫪.👩‍🦰"].activeId&&!o.cancelled));
    assert.ok(s.deeds[s.names.nexus.activeId].records.length>=2); assert.ok(s.sequence>=15); assert.equal(initial.durability,"durable-object-sqlite");
  });
  const browserResult=await browserSmoke(base,ev); save("browser-result.json",browserResult);
  check("rendered browser: search/cart, 17-action handoff, six pills, no errors/writes",()=>assert.equal(browserResult.actionOptions,17));
  const { privateKey } = generateKeyPairSync("ed25519"), signer = nativePrincipal(privateKey);
  const suffix = randomBytes(6).toString("hex"), now = Math.floor(Date.now()/1000);
  const unsigned = (name, requestId, nonce) => prepare({signer,coSigners:[],requestId,nonce,notBefore:0,deadline:now+3600,maxTotal:"1000",maxNetworkFee:"0",action:"announceAuction",params:{name,asset:"POA",reserve:"1000",openAt:now+60,expectedDeedId:null,expectedVersion:0,metadata:buildMetadataWitness(name)}},cap);
  const packet = signBody(unsigned(`cf${suffix}`,`cf${suffix}`,0),[privateKey]);
  const receipt = await post(packet); save("signed-receipt.json",receipt.body);
  check("signed write intent round-trip and starter grant", () => { assert.equal(receipt.status,200); assert.equal(receipt.body.status,"succeeded"); assert.equal(receipt.body.accepted,true); assert.equal(receipt.body.intentId,intentId(packet.body)); assert.equal(receipt.body.sequence,initial.state.sequence+1); assert.equal(receipt.body.durability,"durable-object-sqlite"); });
  const newNonce=(await api(`/v1/nonce?signer=${signer}`)).body.nonce, newBalance=(await api("/v1/state")).body.state.balances[signer].POA;
  check("new signer nonce and onboarding balance", () => {assert.equal(newNonce,1);assert.equal(newBalance,"10000000");});
  const replay = await post(packet);
  check("exact idempotent retry returns same receipt", () => assert.deepEqual(replay.body,receipt.body));
  const receiptRead = await api(`/v1/receipts/${receipt.body.intentId}`);
  check("receipt lookup", () => { assert.equal(receiptRead.status,200); assert.equal(receiptRead.body.intentId,receipt.body.intentId); });
  const bad = structuredClone(packet); bad.body.params.name="tampered";
  const invalid = await post(bad);
  check("tampered signature rejected without mutation", () => { assert.equal(invalid.status,400); assert.equal(invalid.body.code,"SIGNATURE"); });
  const collision = signBody(unsigned(`collision${suffix}`, packet.body.requestId,0),[privateKey]);
  const conflict = await post(collision);
  check("idempotency conflict rejected", () => { assert.equal(conflict.status,400); assert.equal(conflict.body.code,"IDEMPOTENCY_CONFLICT"); });
  const packets = ["one","two"].map(v=>signBody(unsigned(`cf${v}${suffix}`,`cf${v}${suffix}`,1),[privateKey]));
  const concurrent = await Promise.all(packets.map(post));
  check("concurrent same-nonce writes have one winner", () => { assert.equal(concurrent.filter(v=>v.status===200&&v.body.status==="succeeded").length,1); assert.equal(concurrent.filter(v=>v.status===400&&v.body.code==="NONCE").length,1); });
  const rejectBody = prepare({signer,coSigners:[],requestId:`reject-${suffix}`,nonce:2,notBefore:0,deadline:now+3600,maxTotal:"0",maxNetworkFee:"0",action:"cancelAuction",params:{auctionId:receipt.body.result.auctionId,expectedVersion:1}},cap);
  const rejected = await post(signBody(rejectBody,[privateKey]));
  check("signed business rejection persists bookkeeping", () => { assert.equal(rejected.status,200); assert.equal(rejected.body.status,"rejected"); assert.equal(rejected.body.code,"NOT_SELLER"); });
  for (const [name,headers,status,code] of [
    ["browser Origin blocked",{"content-type":"application/json",origin:"https://poadomains.grok.me"},400,"BROWSER_WRITES_DISABLED"],
    ["browser fetch metadata blocked",{"content-type":"application/json","sec-fetch-site":"same-origin"},400,"BROWSER_WRITES_DISABLED"],
    ["non-exact content type blocked",{"content-type":"application/json; charset=utf-8"},400,"CONTENT_TYPE"],
  ]) { const value=await api("/v1/intents",{method:"POST",headers,body:JSON.stringify(packet)}); check(name,()=>{assert.equal(value.status,status);assert.equal(value.body.code,code);}); }
  const huge = await api("/v1/intents",{method:"POST",headers:{"content-type":"application/json"},body:"x".repeat(65537)});
  check("oversize body blocked",()=>{assert.equal(huge.status,413);assert.equal(huge.body.code,"BODY_TOO_LARGE");});
  const utf8 = await api("/v1/intents",{method:"POST",headers:{"content-type":"application/json"},body:Uint8Array.from([255,254])});
  check("invalid UTF-8 blocked",()=>assert.equal(utf8.status,400));
  const unknown = await api(`/v1/receipts/${"f".repeat(64)}`);
  check("unknown receipt remains unknown",()=>{assert.equal(unknown.status,404);assert.equal(unknown.body.code,"UNKNOWN_OUTCOME");});
  const before = (await api("/v1/state")).body, beforeHealth=(await api("/healthz")).body;
  save("state-before-restart.json",before);save("healthz-before-restart.json",beforeHealth);
  await stop();
  const afterHealth = await start("restart");
  const after = (await api("/v1/state")).body;
  save("state-after-restart.json",after);save("healthz-after-restart.json",afterHealth);
  check("full Wrangler restart preserves all principals",()=>assert.deepEqual(afterHealth.principals,first.principals));
  check("full Wrangler restart preserves every state table and state hash",()=>{assert.deepEqual(after.state,before.state);assert.equal(after.stateHash,before.stateHash);assert.equal(afterHealth.sequence,beforeHealth.sequence);});
  const afterReceipt=await api(`/v1/receipts/${receipt.body.intentId}`);
  check("signed receipt survives restart",()=>assert.deepEqual(afterReceipt.body,receiptRead.body));
  const duplicateAfter=await post(packet);
  check("idempotency survives restart without another grant or sequence",()=>assert.deepEqual(duplicateAfter.body,receipt.body));
  const final=(await api("/v1/state")).body;
  check("no duplicate seed or write on restart",()=>{assert.equal(final.state.sequence,before.state.sequence);assert.equal(final.state.balances[signer].POA,"10000000");});
  save("public-principals.json",afterHealth.principals);
  console.log(`SUMMARY ${results.length} PASS, 0 FAIL (local SQLite emulation, not cloud replication)`);
} catch(error) {
  results.push({name:"integration completion",pass:false,error:error.message});
  console.error(error.message); process.exitCode=1;
} finally {
  try { await stop(); } catch(e) { console.error(e.message);process.exitCode=1; }
  save("results.json",results);
}
