import { Engine } from '../../src/engine.js';
import { ManualClock } from '../../src/clock.js';
export const CONTRACT_TIME = 1000000;
export const CONTRACT_OPTIONS = Object.freeze({
  health:{livePoA:false,principals:{fixture:'public-contract-fixture'}},
  capabilities:{publicExplorerUrl:'https://poadomains.grok.me',escrow:{enabled:false,capabilities:'/v1/escrow/capabilities'}},
});
export const contractEngine = (config:unknown) => new Engine(config,new ManualClock(CONTRACT_TIME));
