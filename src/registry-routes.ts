import { errorReply, errorEnvelope } from './errors.js';
/** Host-independent registry routes. HTTP bounds/auth and durable storage stay in adapters. */
import { Engine } from './engine.js';
import { capabilities } from './interface.js';
import { need, parseJSON } from './core.js';
import { quote, readContext, readName, readAuction, readOffer, readPage } from './registry-reads.js';
import { normalizeName } from './names.js';
export interface RegistryCall { method: string; path: string; query: Record<string,string>; packet?: string; requestId?:string }
export interface RegistryReply { status: number; jsonText: string }
export interface RegistryRouteOptions {
  health?: Record<string,unknown>;
  capabilities?: Record<string,unknown>;
  beforeSubmit?: () => void;
}
export const REGISTRY_ROUTES = Object.freeze([
  ['GET','/healthz'], ['GET','/v1/capabilities'], ['GET','/v1/state'], ['GET','/v1/resolve'],
  ['GET','/v1/time'], ['GET','/v1/quote'], ['GET','/v1/names/:name'], ['GET','/v1/auctions/:id'], ['GET','/v1/offers/:id'],
  ['GET','/v1/auctions'], ['GET','/v1/offers'], ['POST','/v1/intents/preview'],
  ['GET','/v1/nonce'], ['GET','/v1/receipts/:id'], ['POST','/v1/intents'],
]);
export function registryRoute(e: Engine, call: RegistryCall, options: RegistryRouteOptions = {}): RegistryReply {
  const reply = (status: number, body: unknown) => { const result=status>=400?errorReply(status,body,call.requestId??"registry"): {status,body}; return {status:result.status,jsonText:JSON.stringify(result.body)}; };
  const ok = (body: unknown) => reply(200,body);
  if(call.method==='GET') {
    if(call.path==='/healthz') return ok({status:'ok',processAlive:true,chainId:e.config.chainId,revision:e.config.revision,sequence:e.snapshot().sequence,durability:e.durability(),...options.health});
    if(call.path==='/v1/capabilities') {
      need(Object.keys(call.query).every(k=>k==='include') && (call.query.include===undefined||call.query.include==='emoji'),'QUERY_NOT_ALLOWED');
      const cap={...capabilities(e),...options.capabilities};
      if(call.query.include!=='emoji') {
        delete cap.emojiManifest;
        if(cap.emojiOwnership) {const {multiMemberClasses,...summary}=cap.emojiOwnership;cap.emojiOwnership=summary;}
      }
      return ok({...cap,emojiData:'/v1/capabilities?include=emoji'});
    }
    if(call.path==='/v1/time') return ok(readContext(e));
    if(call.path==='/v1/quote') return ok(quote(e,call.query));
    if(call.path==='/v1/auctions'||call.path==='/v1/offers') return ok(readPage(e,call.path.endsWith('auctions')?'auctions':'offers',call.query));
    if(call.path.startsWith('/v1/names/')) return ok(readName(e,call.path.slice('/v1/names/'.length)));
    if(call.path.startsWith('/v1/auctions/')) return ok(readAuction(e,call.path.slice('/v1/auctions/'.length)));
    if(call.path.startsWith('/v1/offers/')) return ok(readOffer(e,call.path.slice('/v1/offers/'.length)));
    if(call.path==='/v1/state') return ok({state:e.snapshot(),stateHash:e.stateHash(),observedServerTime:e.observedTime(),durability:e.durability(),finality:'registry-committed'});
    if(call.path==='/v1/resolve') return ok(e.resolve(normalizeName(call.query.name,e.normalizationMode).canonical));
    if(call.path==='/v1/nonce') return ok({nonce:e.nextNonce(call.query.signer??'')});
    if(call.path.startsWith('/v1/receipts/')) {
      const id=call.path.slice('/v1/receipts/'.length); need(/^[0-9a-f]{64}$/.test(id),'INTENT_ID');
      const receipt=e.receipt(id); return reply(receipt?200:404,receipt?.status==="rejected"?{...receipt,...errorEnvelope(receipt.code,receipt.requestId,{accepted:true})}:receipt??{status:'unknown',code:'UNKNOWN_OUTCOME'});
    }
    return reply(404,{code:'NOT_FOUND'});
  }
  if(call.method==='POST'&&call.path==='/v1/intents/preview') {
    // Same read-only admission guard, but never the durable submit/storage path.
    options.beforeSubmit?.();
    const receipt=e.preview(parseJSON(call.packet??''));
    return ok({previewOnly:true,accepted:false,committed:false,wouldSucceed:receipt.status==='succeeded',
      receipt:{...receipt,...(receipt.status==='rejected'?errorEnvelope(receipt.code,receipt.requestId,{accepted:false}):{})},...readContext(e)});
  }
  if(call.method==='POST'&&call.path==='/v1/intents') {
    options.beforeSubmit?.();
    const receipt=e.submit(parseJSON(call.packet??''));
    return ok({...receipt,...(receipt.status==='rejected'?errorEnvelope(receipt.code,receipt.requestId,{accepted:true}):{}),accepted:true,durability:e.durability(),finality:'registry-committed'});
  }
  return reply(405,{code:'METHOD_NOT_ALLOWED'});
}
