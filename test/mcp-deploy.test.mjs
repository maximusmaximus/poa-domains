import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseConfig,
  productionConfig,
  expectedPolicy,
  POLICY,
  ADDRESS,
} from "../scripts/worker-deploy.mjs";
test("first MCP deploy keeps disabled committed defaults, live-binding preservation and exact public policy checklist", () => {
  const original = parseConfig(readFileSync("wrangler.jsonc", "utf8")),
    copy = structuredClone(original),
    safe = productionConfig(original);
  assert.deepEqual(original, copy);
  assert.equal(original.vars.POA_ESCROW_ENABLED, "false");
  assert.equal(original.vars.POA_ESCROW_NETWORK_WRITES, "false");
  assert.equal(safe.keep_vars, true);
  assert.ok(Object.keys(safe.vars).every((k) => !k.startsWith("POA_ESCROW_")));
  assert.deepEqual(safe.ratelimits, [
    {
      name: "MCP_RATE_LIMITER",
      namespace_id: "2026110908",
      simple: { limit: 60, period: 60 },
    },
  ]);
  const live = {
    POA_ESCROW_ENABLED: "true",
    POA_ESCROW_NETWORK_WRITES: "approved-v1",
    POA_ESCROW_ADDRESS: ADDRESS,
    POA_ESCROW_PER_TX: "250000.000000",
    POA_ESCROW_DAILY: "1000000.000000",
    POA_ESCROW_ENGINE_SHA256: original.vars.POA_ESCROW_ENGINE_SHA256,
    POA_ESCROW_PARAMS_SHA256: original.vars.POA_ESCROW_PARAMS_SHA256,
  };
  assert.deepEqual(expectedPolicy(live), live);
  const docs = readFileSync("docs/worker-deploy.md", "utf8");
  for (const key of POLICY)
    assert.ok(docs.includes("| `" + key + "` | `" + live[key] + "` |"), key);
  const workflow = readFileSync(".github/workflows/deploy-worker.yml", "utf8");
  assert.match(workflow, /vars\.WORKER_DEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /environment: production/);
  assert.match(
    readFileSync("docs/MCP.md", "utf8"),
    /Each later release\s+requires Max's separate approval/,
  );
});
