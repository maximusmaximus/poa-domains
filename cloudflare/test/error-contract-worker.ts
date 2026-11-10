// Local-only gateway/RPC seam. Compare the untouched escrow facade against the real
// production ingress; existing escrow/SQLite suites retain business/crypto coverage.
import worker from '../worker.js';
import {escrowHttp} from '../escrow-http.js';
import {networkStatusMonitor} from '../network-status.js';
const wallet='poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf';
let dispatches=0;
export default {async fetch(request:Request,env:{POA_ESCROW_ENABLED:string;PUBLIC_EXPLORER_URL:string;ESCROW_ADMIN_TOKEN:string}) {
 const u=new URL(request.url);
 if(u.pathname==='/__hold'){await networkStatusMonitor.getStatus({bypassCache:true});await networkStatusMonitor.getStatus({bypassCache:true});return Response.json({held:true});}
 if(u.pathname==='/__audit')return Response.json({dispatches});
 const fault=request.headers.get('x-fixture-fault');
 const rpc={
  async escrowRead(path:string,query:Record<string,string>){dispatches++;if(fault)throw Error(fault);return path==='capabilities'?{enabled:true,paused:false,held:false,address:wallet,limits:{perTransaction:'250000.000000',daily:'1000000.000000'},serverTime:1000000}:{path,query,serverTime:1000000,items:[]};},
  async escrowCommand(packet:string,endpoint:string){dispatches++;if(fault)throw Error(fault);return {action:endpoint,packet,account:{available:'1.000000',held:'0.000000'},accepted:true};},
  async escrowAdmin(packet:string){dispatches++;return {status:200,jsonText:JSON.stringify({paused:false,address:wallet,packet})};},
  async handle(){return {status:404,jsonText:'{"code":"NOT_FOUND"}'};},
 };
 if(u.pathname.startsWith('/__legacy/')){u.pathname=u.pathname.slice('/__legacy'.length);return escrowHttp(new Request(u,request),env,()=>rpc);}
 return worker.fetch(request,{...env,REGISTRY:{getByName:()=>rpc}} as unknown as Env);
}};
