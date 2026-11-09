/** HTTP boundary for signed public escrow calls. Admin HTTP remains separate. */
import { need, parseJSON, exact, Fault } from "../src/core.js";
interface PublicEnv { POA_ESCROW_ENABLED?:string;POA_ESCROW_PER_TX?:string;POA_ESCROW_DAILY?:string;PUBLIC_EXPLORER_URL:string; }
export interface PublicRpc { escrowRead(path:string,query:Record<string,string>):Promise<unknown>;escrowCommand(packet:string,endpoint:string):Promise<unknown>; }
const headers={"cache-control":"no-store","content-type":"application/json; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"no-referrer"};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
export async function escrowHttp(request:Request,env:PublicEnv,rpc:()=>PublicRpc):Promise<Response>{
  let dispatched=false;
  try{
    const u=new URL(request.url),part=u.pathname.slice("/v1/escrow/".length);
    need(u.pathname.startsWith("/v1/escrow/")&&["capabilities","market","domain","intent","withdraw","command","account"].includes(part),"ESCROW_ROUTE");
    const keys=[...u.searchParams.keys()];need(new Set(keys).size===keys.length,"DUPLICATE_QUERY");
    if(env.POA_ESCROW_ENABLED!=="true")return part==="capabilities"&&request.method==="GET"?reply(200,{enabled:false,paused:true,held:true,holdReason:"POA payments not open",address:null,limits:{perTransaction:env.POA_ESCROW_PER_TX??"250000.000000",daily:env.POA_ESCROW_DAILY??"1000000.000000"}}):reply(404,{code:"NOT_FOUND"});
    if(request.method==="GET"){
      need(["capabilities","market","domain","intent"].includes(part),"METHOD_NOT_ALLOWED");
      const allowed=part==="domain"?["name"]:part==="intent"?["id","txid"]:[];
      need(keys.every(k=>allowed.includes(k)),"QUERY_NOT_ALLOWED");
      const query=Object.fromEntries(u.searchParams);if(part==="domain")need(typeof query.name==="string"&&query.name.length>0&&query.name.length<=256,"ESCROW_NAME");
      if(part==="intent"){need(/^[0-9a-f]{64}$/.test(query.id??""),"ESCROW_DEPOSIT_INTENT");if(query.txid)need(/^[0-9a-f]{64}$/.test(query.txid),"ESCROW_TXID");}
      return reply(200,await rpc().escrowRead(part,query));
    }
    need(request.method==="POST"&&["intent","withdraw","command","account"].includes(part),"METHOD_NOT_ALLOWED");need(!u.search,"QUERY_NOT_ALLOWED");
    need(!request.headers.has("authorization"),"ESCROW_NO_ADMIN_CREDENTIAL");
    const origin=request.headers.get("origin");if(origin)need(origin===u.origin||origin===new URL(env.PUBLIC_EXPLORER_URL).origin,"ORIGIN");
    need(!["cross-site","same-site"].includes(request.headers.get("sec-fetch-site")??""),"ORIGIN");
    need(request.headers.get("content-type")==="application/json"&&!request.headers.has("content-encoding"),"CONTENT_TYPE");
    const len=request.headers.get("content-length");if(len!==null)need(/^[0-9]+$/.test(len)&&Number(len)<=65536,"BODY_TOO_LARGE");
    const reader=request.body?.getReader();need(reader,"EMPTY_BODY");let size=0;const chunks:Uint8Array[]=[];
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw new Fault("BODY_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
    const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);exact(parseJSON(text),["command","signature"]);
    dispatched=true;return reply(200,await rpc().escrowCommand(text,part));
  }catch(e){const code=e instanceof Fault?e.code:e instanceof Error&&/^ESCROW_[A-Z_]+$/.test(e.message)?e.message:"ESCROW_HELD";
    const unknown=dispatched&&(code==="ESCROW_UNAVAILABLE"||code==="ESCROW_HELD"||!(e instanceof Fault)&&!(e instanceof Error&&/^ESCROW_[A-Z_]+$/.test(e.message)));
    return reply(unknown?503:code==="BODY_TOO_LARGE"?413:409,{code,accepted:unknown?"unknown":false,...(unknown?{message:"Keep the exact signed request. Query your signed account; do not create a new request key or payment."}:{})});}
}
