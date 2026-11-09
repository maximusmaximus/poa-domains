/** Sanitized public views and payer-authenticated commands. Never exports a journal or signing material. */
import { Escrow, State } from "./escrow.js";
import { verifyCommand, address, decimal, micros } from "./escrow-codec.js";
import { exact, need, parseJSON } from "../src/core.js";
const PUBLIC_ACTIONS=new Set(["intent","detect","withdraw","open","list","bid","buy","cancel","expire","settle","repair-title","view"]);
export function marketView(s: State, name?: string) {
  return Object.values(s.auctions).filter(a=>name===undefined||a.name===name).slice(-100).map(a=>({
    id:a.id,name:a.name,seller:a.seller,kind:a.kind??"auction",price:decimal(BigInt(a.reserve)),
    status:a.status,closes:a.closes,createdAt:a.createdAt??null,
    high:a.high?{payer:a.high.payer,amount:decimal(BigInt(a.high.amount))}:null,
    settlement:s.settlements[a.id]?.status??null,
    history:(a.history??[{event:a.status,at:a.createdAt??0}]).slice(-100).map(h=>({...h,...(h.amount?{amount:decimal(BigInt(h.amount))}:{})})),
  }));
}
export function accountView(s:State,payer:string){address(payer);return {
  payer,available:decimal(BigInt(s.available[payer]??"0")),
  deposits:Object.entries(s.deposits).filter(([,d])=>d.payer===payer).slice(-100).map(([id,d])=>({intent:id,amount:d.amount,status:d.tx?"final":"waiting",txid:d.tx,createdAt:d.createdAt??null})),
  refunds:Object.values(s.payments).filter(p=>p.kind==="refund"&&p.to===payer).slice(-100).map(p=>({id:p.id,amount:decimal(BigInt(p.amount)),status:p.status,txid:p.txid,day:p.day})),
};}
export async function publicCommand(getEscrow:()=>Escrow,packetText:string,registryId:string,endpoint:string,now=Date.now(),operational=true){
  need(["intent","withdraw","account","command"].includes(endpoint),"ESCROW_ROUTE");
  const packet=parseJSON(packetText),c=verifyCommand(packet,registryId,Math.floor(now/1000));
  need(c.expires<=Math.floor(now/1000)+3600,"ESCROW_COMMAND_EXPIRY");need(PUBLIC_ACTIONS.has(c.action),"ESCROW_ACTION");
  const expected:Record<string,string>={intent:"intent",withdraw:"withdraw",account:"view"};
  if(expected[endpoint])need(c.action===expected[endpoint],"ESCROW_ENDPOINT_ACTION");
  const escrow=getEscrow();
  if(c.action==="view"){exact(c.params,[]);return {action:c.action,account:accountView(escrow.state(),c.actor)};}
  need(operational,"ESCROW_OPERATOR_SETUP_HELD");
  if(c.action==="intent")need(micros(c.params.amount)<=micros(escrow.policy.perTx),"ESCROW_PAYOUT_LIMIT");
  const result=await escrow.command(c);
  return {action:c.action,result,account:accountView(escrow.state(),c.actor)};
}
