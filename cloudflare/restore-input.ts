// Only for the loopback, local-only restore route. Public ingress keeps parseJSON.
import { exact, integer, need, obj } from "../src/core.js";
export const RESTORE_INPUT_LIMIT = 16 * 1024 * 1024;
const ROLES = ["issuer", "treasury", "alice", "bob", "carol"];
export interface RestoreInput { backup: string; keys: Record<string,string>; escrow?: unknown; }
/** Bounded JSON with duplicate/unsafe-key rejection, but without public ingress's
 * no-secret/string policy: this isolated operation deliberately imports PEMs.
 * Errors are fixed codes and never include input or key material.
 */
export function parseRestoreInput(source: string): RestoreInput {
  need(Buffer.byteLength(source)<=RESTORE_INPUT_LIMIT,"BODY_TOO_LARGE");
  let i=0,nodes=0;
  const ws=()=>{while(i<source.length&&/[ \t\r\n]/.test(source[i]!))i++;};
  const string=():string=>{
    need(source[i++]==='"',"RESTORE_JSON");const start=i-1;
    while(i<source.length){
      const c=source[i++];
      if(c==='"')return JSON.parse(source.slice(start,i)) as string;
      if(c==='\\')i++;
    }
    throw new Error("RESTORE_JSON");
  };
  const value=(depth:number):any=>{
    need(depth<=64&&++nodes<=200000,"RESTORE_JSON_LIMIT");ws();const c=source[i];
    if(c==='"')return string();
    if(c==='{'||c==='['){
      i++;ws();const array=c==='[',end=array?']':'}';const out:any=array?[]:{};
      if(source[i]===end){i++;return out;}
      while(i<source.length){
        if(array)out.push(value(depth+1));
        else {
          const k=string();need(!["__proto__","prototype","constructor"].includes(k),"UNSAFE_KEY");
          need(!Object.hasOwn(out,k),"DUPLICATE_KEY");ws();need(source[i++]===':',"RESTORE_JSON");out[k]=value(depth+1);
        }
        ws();const next=source[i++];if(next===end)return out;need(next===',',"RESTORE_JSON");ws();
      }
      throw new Error("RESTORE_JSON");
    }
    for(const [word,v] of [["true",true],["false",false],["null",null]] as const)
      if(source.startsWith(word,i)){i+=word.length;return v;}
    const m=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(i));
    need(m,"RESTORE_JSON");i+=m[0].length;return integer(Number(m[0]));
  };
  let raw:unknown;
  try {raw=value(0);ws();need(i===source.length,"RESTORE_JSON");}
  catch(e){
    // JSON.parse's syntax diagnostics can quote input. Never propagate them.
    if(e instanceof Error&&/^(?:RESTORE_JSON(?:_LIMIT)?|DUPLICATE_KEY|UNSAFE_KEY|INTEGER)$/.test(e.message))throw e;
    throw new Error("RESTORE_JSON");
  }
  const body=exact(raw,["backup","keys"],["escrow"]);
  need(typeof body.backup==="string"&&body.backup.length>0,"BACKUP_FORMAT");
  const keys=exact(body.keys,ROLES);
  for(const v of Object.values(keys))need(typeof v==="string"&&v.length<=16384&&
    /^-----BEGIN PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PRIVATE KEY-----\r?\n?$/.test(v),"RESTORE_KEY_FORMAT");
  if(body.escrow!==undefined){const a=exact(body.escrow,["policy","rows"]);obj(a.policy);need(Array.isArray(a.rows),"ESCROW_JOURNAL_CORRUPT");}
  return body as RestoreInput;
}
