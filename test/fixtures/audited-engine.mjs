// Public snapshots only: no bootstrap, private keys, signatures, persistence or network.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Engine} from '../../dist/src/engine.js';
import {mainnetConfig} from '../../dist/src/config.js';
import {ManualClock} from '../../dist/src/clock.js';
import {publicRegistryRoute,HIDDEN,AUDITED_REGISTRY,unavailableKey} from '../../dist/public-registry-view.mjs';
import {publicNameUnavailable,registryUnit} from '../../reference-web/shared.js';
export const original=JSON.parse(readFileSync(new URL('./public-view-state.json',import.meta.url)));
export function auditedEngine(){const e=new Engine(mainnetConfig(HIDDEN.accounts[0],HIDDEN.accounts[1],HIDDEN.accounts.slice(2,5)),new ManualClock(original.observedServerTime));e.state=structuredClone(original.state);assert.equal(e.registryId,AUDITED_REGISTRY);return e;}
export function get(e,path,query={}){const r=publicRegistryRoute(e,{method:'GET',path,query},{});return {status:r.status,data:JSON.parse(r.jsonText)};}
