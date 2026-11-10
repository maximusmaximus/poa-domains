import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeReader} from '../dist/src/native.js';
import {createLiveNetworkReader} from '../web/live-network.js';
import {parseNetworkStatus} from '../web/network-schema.js';
const now=1800000000000;
const fixture=()=>({status:{chain_id:'poa-mainnet-1',checkpoint:{height:100,cutoff_ts:now/1000-21600},epochs_closed:57,agents_joined:99,txs:20,final:19,K:5},facts:{chain_id:'poa-mainnet-1',open_epoch:57,engine_sha256:'a'.repeat(64),params_sha256:'b'.repeat(64),economics:{K:5}}});
function readers(f) {
 const transport=async url=>{
  const response=new Response(JSON.stringify(url.endsWith('/status')?f.status:f.facts),{headers:{'content-type':'application/json'}});
  Object.defineProperty(response,'url',{value:url});return response;
 };
 return [new NativeReader(transport,()=>now).network(),createLiveNetworkReader({fetch:transport,now:()=>now}).observe()];
}
test('Node and browser report exactly the same schema projection',async()=>{
 const [native,browser]=await Promise.all(readers(fixture()));assert.deepEqual(native,browser);
});
test('both observation readers reject the same malformed and inconsistent reports',async()=>{
 for(const edit of [f=>f.status.chain_id='other',f=>f.facts.chain_id='other',f=>f.status.final=21,f=>f.status.checkpoint.height=-1,f=>f.status.K=257,f=>f.facts.open_epoch++,f=>f.facts.economics.K++,f=>f.facts.engine_sha256='invalid',f=>f.status.checkpoint.cutoff_ts=now/1000+301]) {
  const f=fixture();edit(f);const outcomes=await Promise.allSettled(readers(f));assert.ok(outcomes.every(o=>o.status==='rejected'));
 }
});
test('status-only availability compatibility is explicit: no facts fetch, invented fields or registry readiness',()=>{
 const fail=code=>{throw Error(code)};
 assert.deepEqual(parseNetworkStatus({epochs_closed:57},{availabilityOnly:true,now,fail}),{epochsClosed:57,checkpointHeight:null,agentsJoined:null,txs:null,final:null,stale:null,staleAgeS:null});
 const f=fixture();assert.equal(parseNetworkStatus(f.status,{availabilityOnly:true,now,fail}).checkpointHeight,100);
 assert.throws(()=>parseNetworkStatus({...f.status,chain_id:'other'},{availabilityOnly:true,now,fail}));
 assert.throws(()=>parseNetworkStatus({chain_id:'poa-mainnet-1'},{availabilityOnly:true,now,fail}));
});
