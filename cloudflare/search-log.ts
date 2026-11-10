/** Anonymous, bounded, explicit search telemetry only. Never calls REGISTRY or escrow. */
import { normalizeName } from "../src/names.js";
import { correlationId, errorEnvelope } from "../src/errors.js";
import { parseMcpJSON } from "../src/mcp-json.js";
export interface SearchLogEnv { SEARCH_LOGS?: R2Bucket; BACKEND_HOST: string; MCP_RATE_LIMITER?: {limit(options:{key:string}):Promise<{success:boolean}>}; }
const results=new Set(["available","auction","owned","unavailable","unknown"]);
export function safeSearchQuery(value:unknown):string {
 if(typeof value!=="string"||new TextEncoder().encode(value).length>256)throw Error("SEARCH_QUERY_PRIVATE");
 const q=value.trim();
 // Do not persist contact, credential, wallet/address, long numeric or encoded identifier lookalikes.
 if(!q||/[@:/\\\s]|private|password|mnemonic|secret|seed|BEGIN|poa1|ed25519/i.test(q)||/[0-9]{7,}|[a-f0-9]{32,}|[A-Za-z0-9]{40,}/i.test(q))throw Error("SEARCH_QUERY_PRIVATE");
 try{return normalizeName(q,"emoji17-full").canonical;}catch{throw Error("NAME");}
}
async function boundedBody(request:Request):Promise<string>{const reader=request.body?.getReader();if(!reader)throw Error("EMPTY_BODY");const chunks:Uint8Array[]=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();throw Error("BODY_TOO_LARGE");}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
export async function searchLog(request:Request,env:SearchLogEnv):Promise<Response>{
 const requestId=correlationId(undefined),headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
 const fail=(status:number,code:string)=>Response.json(errorEnvelope(code,requestId),{status,headers});
 const u=new URL(request.url),allowed=new Set(["poadomains.grok.me",env.BACKEND_HOST]);if(["127.0.0.1","localhost"].includes(u.hostname))allowed.add(u.hostname);
 if(!allowed.has(u.hostname))return fail(403,"HOST");
 if(request.method!=="POST")return fail(405,"METHOD_NOT_ALLOWED");if(u.search)return fail(400,"QUERY_NOT_ALLOWED");
 let origin:URL;try{origin=new URL(request.headers.get("origin")??"");}catch{return fail(403,"HOST");}
 if(!allowed.has(origin.hostname)||origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash||(u.hostname!=="127.0.0.1"&&u.hostname!=="localhost"&&(origin.protocol!=="https:"||!!origin.port))||origin.origin!==u.origin&&!(["poadomains.grok.me",env.BACKEND_HOST].includes(origin.hostname)&&["poadomains.grok.me",env.BACKEND_HOST].includes(u.hostname)))return fail(403,"HOST");
 if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")??""))return fail(400,"CONTENT_TYPE");
 if(request.headers.has("content-encoding"))return fail(400,"ENCODING");const length=request.headers.get("content-length");if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>1024))return fail(413,"BODY_TOO_LARGE");
 let query:string,result:string;
 try{const body=parseMcpJSON(await boundedBody(request),1024,8);if(!body||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,"query")||!Object.hasOwn(body,"result")||!results.has(body.result))return fail(400,"INVALID_REQUEST");query=safeSearchQuery(body.query);result=body.result;}
 catch(e){const code=e instanceof Error&&["SEARCH_QUERY_PRIVATE","NAME","EMPTY_BODY","BODY_TOO_LARGE","DUPLICATE_KEY"].includes(e.message)?e.message:"INVALID_REQUEST";return fail(code==="BODY_TOO_LARGE"?413:400,code);}
 if(!env.SEARCH_LOGS)return fail(503,"SEARCH_LOG_DISABLED");
 if(env.MCP_RATE_LIMITER){try{if(!(await env.MCP_RATE_LIMITER.limit({key:"anonymous-searches"})).success)return fail(429,"SEARCH_LOG_RATE_LIMITED");}catch{return fail(503,"SEARCH_LOG_LIMITER_UNAVAILABLE");}}
 const timestamp=new Date().toISOString(),key="v1/"+timestamp.slice(0,10)+"/"+crypto.randomUUID()+".jsonl";
 // Immutable daily-partitioned single-event JSONL shards avoid lossy concurrent append/read-modify-write.
 // No request identifiers, IPs, headers, principal, user-agent, cookies or hashes are stored.
 const line=JSON.stringify({query,timestamp,host:u.hostname,result,source:"submitted-search"})+"\n";
 try{const object=await env.SEARCH_LOGS.put(key,line,{onlyIf:{etagDoesNotMatch:"*"},httpMetadata:{contentType:"application/x-ndjson"}});if(!object)return fail(503,"SEARCH_LOG_FAILED");}
 catch{return fail(503,"SEARCH_LOG_FAILED");}
 return Response.json({saved:true,key},{status:200,headers});
}
