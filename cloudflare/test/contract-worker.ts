// Local-only seam: production HTTP adapter + the real shared Engine route core.
// SQLite persistence is tested independently by the unchanged production integration suite.
import worker from '../worker.js';
import { Fault } from '../../src/core.js';
import { registryRoute, type RegistryCall } from '../../src/registry-routes.js';
import { contractEngine, CONTRACT_OPTIONS } from '../../test/fixtures/contract-engine.js';
let engine:ReturnType<typeof contractEngine>;
export default {
  fetch(request:Request,env:{CONTRACT_CONFIG:string;ASSETS:Fetcher;PUBLIC_EXPLORER_URL:string;BACKEND_HOST:string}) {
    engine ??= contractEngine(JSON.parse(env.CONTRACT_CONFIG));
    const registry = {handle(call:RegistryCall) {
      try { return registryRoute(engine,call,CONTRACT_OPTIONS); }
      catch(error) {
        if(error instanceof Fault) return {status:400,jsonText:JSON.stringify({code:error.code,accepted:false})};
        throw error;
      }
    }};
    return worker.fetch(request,{...env,REGISTRY:{getByName:()=>registry}} as unknown as Env);
  },
};
