import test from "node:test";
import assert from "node:assert/strict";
import { publicDemoFixture } from "./reference-fixture.js";
import { prepare } from "../src/interface.js";
import { canonical, hash } from "../src/core.js";
import { nameKey } from "../src/names.js";
import { ACTIONS } from "../src/actions.js";
test("Isolated reference test fixture comes from engine with public-only data, explicit absent backend and all 17 action examples", () => {
  const f = publicDemoFixture();
  assert.equal(f.state.stateHash, hash("local-state/v1", f.state.state));
  for (const entry of Object.values(f.state.state.names))
    assert.equal(entry.key, nameKey(f.capabilities.registryId, entry.name));
  assert.equal(f.details.apiEndpoint, null);
  assert.equal(f.details.keysDiscarded, true);
  assert.equal(f.capabilities.livePoA, false);
  assert.equal(f.state.finality, "synthetic-snapshot-not-chain-finality");
  assert.deepEqual(Object.keys(f.examples).sort(), Object.keys(ACTIONS).sort());
  for (const x of Object.values(f.examples))
    assert.ok(prepare(x, f.capabilities));
  const serialized = canonical(f);
  assert.doesNotMatch(serialized, /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/);
  assert.doesNotMatch(serialized, /"(?:privateKey|secret|mnemonic|seed)"/);
  assert.doesNotMatch(serialized, /https?:\/\/(?:localhost|127\.0\.0\.1)/);
  assert.equal(Object.values(f.state.state.deeds).length, 3);
});
