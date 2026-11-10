import { ui } from "./ui-state.js?v=1065cb322a67";
import { add, el, endpointBase } from "./ui-core.js?v=1065cb322a67";
import { nameLink } from "./ui-router.js?v=1065cb322a67";
import { actionLabel } from "./ui-copy.js?v=1065cb322a67";
export function managedNames(state,owner){return Object.values(state?.names??{}).map(n=>state.deeds?.[n.activeId]).filter(d=>d&&!d.retired&&d.owner===owner);}
export function managementPlan(action,deed,state,owner,price="100",hours="168"){
 if(deed.owner!==owner||deed.retired)throw Error("This address is not the active registry holder.");
 if(!/^[1-9][0-9]{0,38}$/.test(price)||!/^[1-9][0-9]{0,4}$/.test(hours))throw Error("Use a whole-number POA price and a positive number of hours.");
 const identity={name:deed.name,expectedDeedId:deed.id,expectedVersion:deed.version};let params,coSigners=[];
 if(action==="createChildOffer"){if(deed.parentId)throw Error("Only a root can offer direct subdomains.");params={parent:deed.name,parentDeedId:deed.id,expectedOwnerVersion:deed.ownerVersion,asset:"POA",price,validUntil:state.time+Number(hours)*3600,rights:{kind:"permanent"},labels:null,maxUses:1};}
 else if(action==="sellFixed")params={...identity,asset:"POA",price,validUntil:state.time+Number(hours)*3600};
 else if(action==="revokeChild"){const parent=state.deeds[deed.parentId];if(!parent)throw Error("Only a subdomain can be retired.");params={...identity,parentOwnerVersion:parent.ownerVersion};coSigners=[parent.owner];}
 else throw Error("Unsupported management action.");
 return {action,signer:owner,coSigners,params};
}
export function renderManagement(){const box=el("manageNames"),owner=el("manageOwner")?.value.trim();if(!box)return;box.replaceChildren();el("managePrompt").textContent="";if(!owner)return;
 if(!/^(poa1[1-9A-HJ-NP-Za-km-z]{30,60}|ed25519:[0-9a-f]{64})$/.test(owner)){add(box,"p","Use a public owner address only — never a private key.","badge-warn");return;}
 const names=managedNames(ui.latestState,owner);if(!names.length){add(box,"p","No active names for this address in the current registry snapshot.","muted");return;}
 for(const d of names){const card=add(box,"article","","card"),h=add(card,"h4","");nameLink(h,d.name);add(card,"p",d.parentId?"Subdomain · application-registry record":"Root domain · application-registry record","badge");if(d.parentId){const p=add(card,"p","Child of ");nameLink(p,ui.latestState.deeds[d.parentId]?.name??"");}
  const label=add(card,"label","Listing / subdomain price (POA)"),price=add(label,"input","");price.value="100";price.inputMode="numeric";price.setAttribute("aria-label","POA listing price for "+d.name);
  const controls=add(card,"div","","button-row");for(const action of ["sellFixed",d.parentId?"revokeChild":"createChildOffer"]){if(ui.cap?.ownership?.disabledActions?.includes(action)||!ui.cap?.actions?.[action])continue;const b=add(controls,"button","Prepare: "+actionLabel(action),"secondary small");b.type="button";b.addEventListener("click",()=>{try{if(ui.registryReadFailed)throw Error("Refresh registry data before preparing a request.");const fresh=ui.latestState.deeds[d.id];const plan=managementPlan(action,fresh,ui.latestState,owner,price.value);el("managePrompt").textContent=[actionLabel(action)+" — unsigned request for your agent.","Endpoint: "+endpointBase(),"Re-quote, preview and verify current ownership before signing. Ask me before submitting. No action was sent.",action==="createChildOffer"?"Offers one permanent direct subdomain; the buyer chooses its label. Existing subdomains do not disappear.":action==="revokeChild"?"Retiring requires the child holder AND parent owner's signatures. A permanent path stays reserved; it does not become available again.":"This prepares a POA listing only; it does not sell the name now.",JSON.stringify(plan,null,2)].join("\n");}catch(e){el("managePrompt").textContent=e.message;}});}
  for(const o of Object.values(ui.latestState.offers??{}).filter(o=>o.parentId===d.id&&!o.cancelled&&o.uses<o.maxUses&&o.validUntil>ui.latestState.time)){const p=add(card,"p",(o.kind==="child"?"Open subdomain offer":"Open sale listing")+": "+o.price+" POA. ");const b=add(p,"button","Prepare removal","secondary small");b.type="button";b.addEventListener("click",()=>{el("managePrompt").textContent="Remove listing — unsigned. Ask the owner's agent to re-quote and preview, then request approval before submitting. Nothing was sent.\n"+JSON.stringify({action:"cancelOffer",signer:owner,params:{offerId:o.id,expectedVersion:o.version}},null,2);});}
 }
}
export function wireManagement(){el("manageLookup")?.addEventListener("click",renderManagement);el("manageOwner")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();renderManagement();}});}
