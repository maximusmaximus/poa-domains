import { authenticate, intentId } from './auth.js';
import { errorEnvelope, correlationId, type ErrorEnvelope } from './errors.js';
import { need, parseJSON, Fault } from "./core.js";
export function endpoint(value: string): string {
  const u = new URL(value);
  const isLocalHttp =
    u.protocol === "http:" &&
    (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  const isOfficialHttps =
    u.protocol === "https:" &&
    (u.hostname === "poadomains.grok.me" || u.hostname.endsWith(".grok.me") ||
      u.hostname === "poadomains-registry.maxinfeld-artshow.workers.dev");
  need(
    (isLocalHttp || isOfficialHttps) &&
      !u.username &&
      !u.password &&
      (u.pathname === "/" || !u.pathname) &&
      !u.search &&
      !u.hash,
    "ENDPOINT",
  );
  return u.origin;
}
export class RequestError extends Fault {
 constructor(code:string,readonly kind:'rejected'|'unknown'|'network',readonly detail:ErrorEnvelope,readonly sent:boolean,readonly httpStatus?:number,readonly retryBody?:string) { super(code); }
}
export async function request(url:string,path:string,packet?:unknown):Promise<any> {
 const base=endpoint(url),hasBody=packet!==undefined,submitting=hasBody&&path==='/v1/intents',id=correlationId(undefined);
 // Validate/serialize before calling fetch: a local failure has never been sent.
 const body=hasBody?JSON.stringify(packet):undefined;
 const signed=submitting?authenticate(parseJSON(body!,65536)):undefined;
 const expectedId=signed?intentId(signed.body):undefined;
 let response:Response,data:any;
 try {
  response=await fetch(base+path,{method:hasBody?'POST':'GET',headers:{'x-request-id':id,...(hasBody?{'content-type':'application/json'}:{})},body,signal:AbortSignal.timeout(5000),redirect:'error'});
  data=parseJSON(await response.text(),16777216);
 } catch {
  const code=submitting?'OUTCOME_UNKNOWN':'NETWORK_ERROR';
  throw new RequestError(code,submitting?'unknown':'network',errorEnvelope(code,id,{accepted:submitting?'unknown':false}),submitting,undefined,submitting?body:undefined);
 }
 const responseId=typeof data?.requestId==='string'?correlationId(data.requestId):id;
 if(data?.accepted==='unknown'||data?.code==='UNKNOWN_OUTCOME') {
  const code=typeof data.code==='string'?data.code:'OUTCOME_UNKNOWN';
  throw new RequestError(code,'unknown',errorEnvelope(code,responseId,{accepted:'unknown'}),submitting,response.status,submitting?body:undefined);
 }
 if(submitting&&response.ok&&(!data||!['succeeded','rejected'].includes(data.status)||data.intentId!==expectedId))throw new RequestError('OUTCOME_UNKNOWN','unknown',errorEnvelope('OUTCOME_UNKNOWN',responseId,{accepted:'unknown'}),true,response.status,body);
 if(!response.ok||data?.status==='rejected') {
  // A malformed/unspecified failure after signed dispatch cannot prove rejection.
  if(submitting&&data?.accepted!==false&&data?.status!=='rejected')throw new RequestError('OUTCOME_UNKNOWN','unknown',errorEnvelope('OUTCOME_UNKNOWN',responseId,{accepted:'unknown'}),true,response.status,body);
  const code=typeof data?.code==='string'?data.code:'HTTP_ERROR',kind=response.status>=500?'network':'rejected';
  throw new RequestError(code,kind,errorEnvelope(code,responseId,{accepted:data?.status==='rejected'||data?.accepted===true}),submitting,response.status);
 }
 return data;
}
