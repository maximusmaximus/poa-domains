// Local-only reuse of the unchanged ingress contract fixture. No production I/O.
import gateway from './error-contract-worker.js';
interface FixtureEnv { POA_ESCROW_ENABLED:string; PUBLIC_EXPLORER_URL:string; ESCROW_ADMIN_TOKEN:string; }
export default { async fetch(request:Request,env:FixtureEnv) {
  const bindings={...env,MCP_RATE_LIMITER:{limit:async()=>({success:true})}};
  return gateway.fetch(request,bindings);
}};
