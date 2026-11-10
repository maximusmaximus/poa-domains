// Local-only DO seam loaded from a structural public-ID fixture. No bootstrap or keys.
import {DurableObject} from 'cloudflare:workers';
import worker from '../worker.js';
import {Engine} from '../../src/engine.js';
import {mainnetConfig} from '../../src/config.js';
import {ManualClock} from '../../src/clock.js';
import {publicRegistryRoute,HIDDEN} from '../public-registry-view.js';
import {Fault} from '../../src/core.js';
import type {RegistryCall} from '../../src/registry-routes.js';
import snapshot from '../../test/fixtures/public-view-state.json';
export class PublicViewFixture extends DurableObject {
 private engine:Engine;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS public_fixture (snapshot TEXT NOT NULL)');const rows=ctx.storage.sql.exec<{snapshot:string}>('SELECT snapshot FROM public_fixture').toArray();if(!rows.length)ctx.storage.sql.exec('INSERT INTO public_fixture VALUES (?)',JSON.stringify(snapshot));const saved=rows.length?JSON.parse(rows[0]!.snapshot):snapshot;this.engine=new Engine(mainnetConfig(HIDDEN.accounts[0],HIDDEN.accounts[1],[...HIDDEN.accounts.slice(2,5)]),new ManualClock(saved.observedServerTime));Object.defineProperty(this.engine,'state',{value:saved.state,writable:true});}
 handle(call:RegistryCall){try{return publicRegistryRoute(this.engine,call,{});}catch(e){if(e instanceof Fault)return {status:400,jsonText:JSON.stringify({code:e.code,accepted:false})};throw e;}}
}
export default worker;
