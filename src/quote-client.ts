/** CLI planning reads only targeted resources; no full-state download or version guesses. */
import { request } from "./client.js";
import { ACTIONS, Action } from "./actions.js";
import { need } from "./core.js";
export async function quoteAction(base:string,action:string,input:Record<string,any>,signer:string) {
  need(Object.hasOwn(ACTIONS,action),"UNSUPPORTED_ACTION");
  need(input&&typeof input==="object"&&!Array.isArray(input),"PARAMS");
  need(Object.keys(input).every(k=>(ACTIONS[action as Action] as readonly string[]).includes(k)),"KEYS");
  let name=input.name??input.parent;
  if(!name&&input.auctionId) name=(await request(base,"/v1/auctions/"+encodeURIComponent(input.auctionId))).auction.name;
  if(!name&&input.offerId) {
    const resource=await request(base,"/v1/offers/"+encodeURIComponent(input.offerId));
    name=action==="fillChildOffer"?`${input.label}.${resource.parentDeed.name}`:resource.parentDeed.name;
  }
  need(typeof name==="string","NAME_REQUIRED");
  const query=new URLSearchParams({name,action,signer});
  for(const key of ["asset","auctionId","offerId"]) if(input[key]!==undefined) query.set(key,String(input[key]));
  const quote=await request(base,"/v1/quote?"+query);
  need(!quote.blockedBy,quote.blockedBy??"QUOTE_INPUT_REQUIRED");
  const params={...quote.params,...input};
  // Always bind the current resource identity/version. Spending choices remain the user's.
  for(const key of ["expectedVersion","expectedDeedId","expectedGeneration","parentDeedId","expectedOwnerVersion","parentOwnerVersion","offerId","auctionId","asset"])
    if(Object.hasOwn(quote.params,key))params[key]=quote.params[key];
  if(Object.hasOwn(quote.params,"name"))params.name=quote.params.name;
  if(action==="announceAuction"&&quote.params.expectedDeedId===null)params.reserve=quote.reserve;
  need(quote.requiredInputs.every((key:string)=>Object.hasOwn(input,key)),"QUOTE_INPUT_REQUIRED");
  return {...quote,params};
}
