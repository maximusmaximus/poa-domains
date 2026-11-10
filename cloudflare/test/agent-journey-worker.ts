// TEST ENTRY ONLY: never imported by production. In-memory real Engine, no PoA/escrow.
import {Engine} from "../../src/engine.js";
import {ManualClock} from "../../src/clock.js";
import {registryRoute, type RegistryCall} from "../../src/registry-routes.js";
import {CONTRACT_OPTIONS, CONTRACT_TIME} from "../../test/fixtures/contract-engine.js";
let attempts=0;
// Install BEFORE dynamically initializing the production network monitor (it captures fetch).
globalThis.fetch=async()=>{attempts++;throw Error("TEST_OUTBOUND_FORBIDDEN");};
const clock=new ManualClock(CONTRACT_TIME),hidden=new Set<string>();
let engine:Engine, runtime:Promise<typeof import("../worker.js")>;
export default {
 async fetch(request:Request,env:Env&{CONTRACT_CONFIG:string}){
  if(new URL(request.url).hostname!=="127.0.0.1")throw Error("LOOPBACK_ONLY");
  engine??=new Engine(JSON.parse(env.CONTRACT_CONFIG),clock);
  const path=new URL(request.url).pathname;
  if(path.startsWith("/v1/escrow/"))throw Error("TEST_ESCROW_FORBIDDEN");
  // Keep the original GET-only human journey guard; telemetry has its own isolated R2/browser suites.
  if(path==="/config.json")return Response.json({mode:"local-reference-only",publicApiBase:""});
  if(path==="/v1/network-status")return Response.json({level:"online",hold:false,message:"🟢 Local test network",livePoA:false});
  const input=request.method==="POST"?await request.clone().json() as any:null;
  // Advance dependency-injected fixture time, never the production clock or an admin endpoint.
  if(input?.params?.name==="quote_domain"&&input.params.arguments.action==="finalize"){
   const auction=Object.values(engine.snapshot().auctions).find(a=>a.name===input.params.arguments.name&&a.status==="live");
   if(auction)clock.set(Math.max(clock.now(),engine.closeEligible(auction)));
  }
  const registry={handle(call:RegistryCall){
   const id=call.path.slice("/v1/receipts/".length);
   if(call.path.startsWith("/v1/receipts/")&&hidden.delete(id))return {status:404,jsonText:JSON.stringify({status:"unknown",code:"UNKNOWN_OUTCOME"})};
   const reply=registryRoute(engine,call,CONTRACT_OPTIONS);
   if(call.path==="/v1/intents"&&request.headers.get("x-test-drop-reply")==="once"){
    const receipt=JSON.parse(reply.jsonText);hidden.add(receipt.intentId);throw Error("TEST_RESPONSE_LOST_AFTER_COMMIT");
   }
   return reply;
  }};
  runtime??=import("../worker.js");
  const response=await(await runtime).default.fetch(request,{...env,REGISTRY:{getByName:()=>registry}} as unknown as Env);
  const headers=new Headers(response.headers);headers.set("x-test-outbound-attempts",String(attempts));
  return new Response(response.body,{status:response.status,headers});
 }
};
