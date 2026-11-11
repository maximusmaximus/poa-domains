import { el, endpointBase } from "./ui-core.js?v=5b78b4c31892";
import { ui } from "./ui-state.js?v=5b78b4c31892";
let lastQuery="",lastAt=0,queue=Promise.resolve();
// Only explicit Check/Enter/idea selections call this. Typing, URL restoration and polls do not.
export function logSubmittedSearch(raw){const query=String(raw??"").trim();if(!query)return;const now=Date.now();if(query===lastQuery&&now-lastAt<1000)return;lastQuery=query;lastAt=now;
 const line=el("searchLogStatus");if(ui.demo||ui.configMode!=="live-registry"){if(line)line.textContent="Search saving is off in this local/demo view.";return;}
 const result=el("searchResult")?.querySelector(".badge-ok,.badge-warn,.badge")?.textContent??"";
 const coarse=/Available/.test(result)?"available":/auction/i.test(result)?"auction":/Owned/.test(result)?"owned":/Reserved|Taken/.test(result)?"unavailable":"unknown";
 queue=queue.then(async()=>{try{const r=await fetch(endpointBase()+"/v1/search-log",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query,result:coarse}),credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(5000)});const ack=r.ok?await r.json():null;const saved=ack?.saved===true&&typeof ack.key==="string";if(line)line.textContent=saved?"Search saved without IP or account details.":r.status===400?"This input was not saved. Only name queries without contact, wallet or key-like text are saved.":"Search could not be saved. Name checking still works.";}catch{if(line)line.textContent="Search could not be saved. Name checking still works.";}});
}
