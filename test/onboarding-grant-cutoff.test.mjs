// Nov 11 2026 (Max approved): stop the 10,000,000 internal-unit onboarding grant on the production registry,
// forward-only. History #1..#16 was applied at sequenceBefore 0..15, so its replay is byte-identical.
import test from "node:test";
import assert from "node:assert/strict";
import { onboardingGrantOpen, PRODUCTION_REGISTRY_ID, ONBOARDING_GRANT_FINAL_SEQUENCE } from "../dist/src/engine.js";
import { auditedEngine, original } from "./fixtures/audited-engine.mjs";

test("production grant gate: open for every historical commit, closed from commit #17; other registries unchanged", () => {
  for (let before = 0; before < 16; before++) assert.equal(onboardingGrantOpen(PRODUCTION_REGISTRY_ID, before), true, "history commit #" + (before + 1));
  assert.equal(ONBOARDING_GRANT_FINAL_SEQUENCE, 16);
  assert.equal(onboardingGrantOpen(PRODUCTION_REGISTRY_ID, 16), false);
  assert.equal(onboardingGrantOpen(PRODUCTION_REGISTRY_ID, 10_000), false);
  assert.equal(onboardingGrantOpen("0".repeat(64), 10_000), true, "fixtures/local registries keep their behavior");
});

test("audited production snapshot: same registryId, sequence 16 and byte-identical stateHash after the change", () => {
  const e = auditedEngine();
  assert.equal(e.registryId, PRODUCTION_REGISTRY_ID);
  assert.equal(e.state.sequence, 16);
  assert.equal(e.stateHash(), original.stateHash);
  assert.equal(original.state.sequence, 16);
});
