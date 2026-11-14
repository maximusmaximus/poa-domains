/** Public projection only. Never passed to Engine, persistence, escrow or backups. */
import { OWNERSHIP_TOKEN } from "../src/emoji-ownership.js";
import { Engine, POA_ONLY_CLOSED_ACTIONS, poaOnlyRegistry } from "../src/engine.js";
import { POA_NEW_NAME_PRICES } from "../src/new-name-prices.js";
import { PUBLIC_VIEW_POLICY } from "../src/api-contract.js";
import { normalizeName } from "../src/names.js";
import { parseJSON } from "../src/core.js";
import { errorReply } from "../src/errors.js";
import { registryRoute, RegistryCall, RegistryReply, RegistryRouteOptions } from "../src/registry-routes.js";
export const AUDITED_REGISTRY = "4c27c2d05c20f03e3ca1dfe90bb2cea4eb24c57b72a6a5d4074dbf15b6bbbed3";
// Explicit inventory approved for hiding on 2026-11-10. IDs are not record bodies.
export const HIDDEN = {
  "deeds": [
    "f2bf13c7ebf4795d5ed2ed936cc55e432ef85cd353558c2054e38724a69310af",
    "60051831a27f81e737950cefd2e029214a954e6aa45a31237f7cd765e27a7a66",
    "6b21ae296aebc53921272a0d2cef85bdf8b5ef5b013fa5ba8343f6d3012e00ed",
    "1565f901db075890dacc6656802e361bfdce6cbf77010ac1d98a6d622efcb370"
  ],
  "auctions": [
    "f23ad3b1526be897abfd8bfefe92b4fc41772c429f99d4b3b29c4a9ad49b0b85",
    "2e3077a6c5bd7574f0e2e57eb3cbacc0fc9da8d8cc77b863cd69dd000e61e2ff",
    "14aede4789d968b3f16eb560d0e1f80d32e9d50db5535007fa159372acbea59d",
    "73684d7f6494b6f4d7925f191691153658e9553d8edeadba076345a086286b73"
  ],
  "offers": [
    "aad935460fab9b8187efdbf938b5994034c4a01f80b9954fd837191032cb27bf",
    "4737a746c22c9367f20a5fcaec219b58e2a1dd3fb4512b4fa3b30820314cbe14",
    "fa7d1d191a672ad177d866640564d2dac6ab2ceceb4dae78baa41d5afe22f8a9"
  ],
  "receipts": [
    "b584efa28491f84351d0cc7b25e408300386ae44ddf09158cab41f5a4ebc7b51",
    "6012306381d8f9df6ecb42aac936786dc715530da767dee7656a7eea1991bb79",
    "e9ca489f9e9cee1363a6cee0f7843d1f143f80da96873d7f2395692611a34cca",
    "a4736ca83a6d8db77b9f260d5a93d156e16ad5350491ca0f0a7bf504137d894c",
    "62baf7c2f943acf4e27a8d5ed7172bc16e4c3b131b90a37cfd6e205b1b6790fd",
    "c5ebe18b942a67cbf73bdb751d3b903bbb3ba42f2fb1ce8ffe249b30fb21aa12",
    "796ff0102ca73f6984675f5382e879ce4dc4684a8bf6efaa5736cf0913c10381",
    "abba1884c297c50fb3ad7a6909a4cebfb7698061fd5c1ad8e5d23b74dd271294",
    "757db19a6a7fa8dd8bb2a08d73c9fdeafcecc3f2a406ab122f0f8a87cda710e9",
    "ebe9f16fbdb69defc713658d0e9c17d0bdf9f7206e29c4e7821cca4bc958e7e2",
    "ce38482edae3e6ea07f0cceb685da8844246ad4f9ee4d4e41a9bd35b8457bfe5",
    "ad178cb4d1fa3118b3cc21023a3f46c0c5fe553714de4e43aa18ad2352c0b7c9",
    "5d86598d1aa962263bb2b1b62b78d17206d1d853ace170d1e135b9751d4ce539",
    "b3dd828d18f2ea650cb3fe40d563c53deab0d32386c8e85843adb97c496da6fc",
    "63f7548f7f38b2c45ef5ffd0259b5e715e20bf212a43dbc311e3ed97be5cd507",
    "7fe71c20478d788cff02caf2b56febc92d2446ddad3af37e5f8ec1ce2cd6b663"
  ],
  "names": [
    "👩‍🦰",
    "nexus",
    "🌐",
    "🚀🚀",
    "🫪.👩‍🦰",
    "🏃test20261109.nexus"
  ],
  "accounts": [
    "poa1EkE7P9EgiRrUGw9NXiTJ6eGSMCqhgwVGNZQqb82tFBLT",
    "poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N",
    "poa1HhdsEoUsj88sk3FqJrP2TcNmC4NCen2xMU6QXP1vh2EX",
    "poa1FMe2rfdiMPbghwihQbrne98uagyJYZ2tv8mVks7udPxg",
    "poa15CHvGV1fq18ovkcrR2VdZCoEDQANNZTnH3rFuPiGJ1LT",
    "poa1EggzAygVv3KecpT3fCrBVjCMf45TxQkxupe4aeCPkqmE"
  ],
  "requests": [
    "seed-1",
    "seed-2",
    "seed-3",
    "seed-4",
    "seed-5",
    "seed-6",
    "seed-7",
    "seed-8",
    "seed-9",
    "seed-10",
    "seed-11",
    "seed-12",
    "seed-13",
    "seed-14",
    "seed-15",
    "approved-practice-emoji-20261109"
  ]
} as const;
/** Production pricing: everything is POA through POA checkout. Shown on every public registry reply. */
export const POA_PRICING = Object.freeze({
  currency: "POA", decimals: 6, payWith: "POA checkout",
  newNames: Object.freeze({ standard: POA_NEW_NAME_PRICES.standard, premium: POA_NEW_NAME_PRICES.premium }),
  checkout: "/v1/escrow/capabilities", market: "/v1/escrow/market", account: "/v1/escrow/account", command: "/v1/escrow/command",
  closedRegistryActions: POA_ONLY_CLOSED_ACTIONS,
  notice: "🪙 Prices, bids, purchases, resales and refunds are in POA through POA checkout. New names: 100 POA (common) or 1000 POA (premium). Read /v1/escrow/capabilities for live status before paying.",
});
/** Every closed action still answers a quote, but with the POA price and checkout path instead of a signable plan. */
function poaQuote(data: any, e: Engine): any {
  const tier = (()=>{ try { return normalizeName(data.name, e.normalizationMode).tier; } catch { return "standard"; } })();
  return { name: data.name, action: data.action, asset: "POA", currency: "POA", available: data.available,
    ownershipConflict: data.ownershipConflict ?? null, owner: data.owner ?? null,
    poaPrice: data.poaPrice ?? null, tier: tier === "premium" ? "premium" : "standard",
    reserve: null, minimumNextBid: null, price: null, fee: null, requiredMaxTotal: null, expectedVersion: null,
    params: null, requiredInputs: [], blockedBy: "POA_ONLY", payWith: POA_PRICING,
    requiresSignedPreview: true, observedServerTime: data.observedServerTime, registryTime: data.registryTime,
    sequence: data.sequence, stateHash: data.stateHash, finality: data.finality };
}
// UI hint only, not an authorization or privacy boundary. Backend checks remain authoritative.
export function unavailableKey(text: string): string { let n=14695981039346656037n; for(const c of text){n=BigInt.asUintN(64,(n^BigInt(c.codePointAt(0)!))*1099511628211n);} return n.toString(16).padStart(16,"0"); }
function hintNameKey(e: Engine, name: string): string {
 return normalizeName(name,e.normalizationMode).labels.map(l=>l.tokens.map(t=>{
   const token=OWNERSHIP_TOKEN.get(t)??t;
   return token.startsWith("u")?String.fromCodePoint(...token.slice(1).split("-").map(x=>parseInt(x,16))):token.slice(1);
 }).join("\u0001")).join(".");
}
const tokens = new Set<string>([...HIDDEN.deeds,...HIDDEN.auctions,...HIDDEN.offers,...HIDDEN.receipts,...HIDDEN.accounts,...HIDDEN.requests]);
function hiddenReference(value: unknown): boolean {
  if (typeof value === "string") return tokens.has(value) || HIDDEN.names.some(n => value === n || value.endsWith("."+n));
  if (Array.isArray(value)) return value.some(hiddenReference);
  return !!value && typeof value === "object" && Object.entries(value).some(([k,v]) => hiddenReference(k)||hiddenReference(v));
}
export function hiddenName(e: Engine, raw: string): boolean {
  const name=normalizeName(raw,e.normalizationMode).canonical;
  if(HIDDEN.names.some(n=>name===n||name.endsWith("."+n))) return true;
  // Preserve emoji ownership-class reservations as well as literal spellings.
  const conflict=e.ownershipConflict(name);
  return !!conflict && hiddenReference(conflict);
}
function denied(call: RegistryCall, accepted: boolean | "unknown" = false): RegistryReply {
  const r=errorReply(409,{code:"PUBLIC_RECORD_WITHHELD",accepted},call.requestId??"registry");
  return {status:r.status,jsonText:JSON.stringify(r.body)};
}
export function publicRegistryRoute(e: Engine, call: RegistryCall, options: RegistryRouteOptions): RegistryReply {
  // Other registries/local fixtures have different identities. Never infer a new
  // deployment's provenance from a sequence number or mutable requestId prefix.
  if(e.registryId!==AUDITED_REGISTRY) return registryRoute(e,call,options);
  const q=call.query;
  if(call.method==="GET") {
    if(q.name!==undefined && hiddenName(e,q.name)) return denied(call);
    if(call.path.startsWith("/v1/names/") && hiddenName(e,decodeURIComponent(call.path.slice(10)))) return denied(call);
    if(Object.values(q).some(hiddenReference)) return denied(call);
    const last=call.path.split("/").at(-1)!;
    if(tokens.has(last)) return denied(call,call.path.startsWith("/v1/receipts/")?"unknown":false);
  } else if(call.packet!==undefined) {
    // Guard before preview/submit: no hidden title can become apparently free,
    // mutate through an ID, or return its old receipt through idempotent replay.
    const p=parseJSON(call.packet) as any;
    if(hiddenReference(p) || [p?.body?.params?.name,p?.body?.params?.parent].some(n=>typeof n==="string"&&hiddenName(e,n))) return denied(call);
  }
  const original=registryRoute(e,call,options);
  if(original.status>=400)return original;
  const data=JSON.parse(original.jsonText);
  if(call.path==="/healthz") delete data.principals;
  if(call.path==="/v1/state") {
    const state=data.state;
    // Filter complete collection entries (including reference indexes, nonces and
    // balances), never individual financial fields inside an otherwise real row.
    for(const key of ["names","deeds","auctions","offers","balances","credits","nonces","receipts","requests","bids"])
      state[key]=Object.fromEntries(Object.entries(state[key]??{}).filter(([k,v])=>!hiddenReference(k)&&!hiddenReference(v)));
    data.publicView={filtered:true,policy:PUBLIC_VIEW_POLICY,stateHashScope:"complete-stored-state",sequenceScope:"complete-stored-state"};
  } else if(call.path==="/v1/capabilities") {
    // No internal-unit fields on the production view: new accounts start empty and pay in POA.
    for(const k of ["onboardingGrantPoa","onboardingGrantRegistryUnits","newAccountRegistryUnits"]) delete data[k];
    data.publicView={filtered:true,policy:PUBLIC_VIEW_POLICY,hiddenNamesRemainReserved:true,unavailableNameKeys:HIDDEN.names.map(n=>unavailableKey(hintNameKey(e,n))),unavailableAccountKeys:HIDDEN.accounts.map(unavailableKey)};
    if(poaOnlyRegistry(e.registryId)) {
      data.assets=Object.fromEntries(Object.entries(data.assets).map(([k])=>[k,{decimals:6,kind:"poa",payWith:"POA checkout",newNamePrices:POA_PRICING.newNames}]));
      data.actions=Object.fromEntries(Object.entries(data.actions).filter(([k])=>!POA_ONLY_CLOSED_ACTIONS.includes(k)));
      if(data.surface?.rest) data.surface.rest.enabledSigningActions=data.surface.rest.enabledSigningActions.filter((k:string)=>!POA_ONLY_CLOSED_ACTIONS.includes(k));
      data.poaOnly={status:"on",...POA_PRICING};
    }
  } else if(call.path==="/v1/quote" && poaOnlyRegistry(e.registryId) && POA_ONLY_CLOSED_ACTIONS.includes(data.action)) {
    const q=poaQuote(data,e);q.pricing=POA_PRICING;return {status:original.status,jsonText:JSON.stringify(q)};
  } else if(call.path==="/v1/auctions" || call.path==="/v1/offers") {
    // Page over the public collection, not a private page: no hidden-ID cursors.
    const kind=call.path.endsWith("auctions")?"auctions":"offers";
    const values=Object.values(e.snapshot()[kind]).filter(v=>!hiddenReference(v)).sort((a,b)=>a.id.localeCompare(b.id));
    if(q.cursor && tokens.has(q.cursor.split(":").at(-1)!)) return denied(call);
    const at=q.cursor?values.findIndex(v=>v.id===q.cursor!.split(":").at(-1))+1:0;
    data.items=values.slice(at,at+data.limit);
    data.nextCursor=at+data.limit<values.length?`v1:${kind}:${data.sequence}:${data.stateHash}:${data.items.at(-1).id}`:null;
  } else if(hiddenReference(data)) return denied(call);
  data.pricing=POA_PRICING;
  return {status:original.status,jsonText:JSON.stringify(data)};
}
