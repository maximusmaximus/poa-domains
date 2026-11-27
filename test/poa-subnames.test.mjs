// POA subname sales (Max t140s1299): parent holders set a fixed POA price; buyers pay through escrow.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACTIONS, ESCROW_ONLY_ACTIONS, ESCROW_ISSUE_ACTIONS } from "../dist/src/actions.js";
import { MCP_INSTRUCTIONS } from "../dist/src/mcp-core.js";
import { POA_CHECKOUT_STEPS } from "../dist/src/new-name-prices.js";
import { discoveryDocuments } from "../dist/src/discovery.js";
import { ERROR_CATALOGUE } from "../dist/src/errors.js";
import { buildSubnameListingPrompt, buildSubnamePurchasePrompt, poaAmount } from "../reference-web/shared.js";

test("issueSubname is escrow-only: never a public registry action", () => {
  assert.ok(!Object.hasOwn(ACTIONS, "issueSubname"));
  assert.ok(!Object.hasOwn(ACTIONS, "escrowSettle"));
  assert.deepEqual(ESCROW_ONLY_ACTIONS.issueSubname, ["name", "parentDeedId", "parentOwnerVersion", "asset", "price", "expectedGeneration", "metadata"]);
  assert.deepEqual(ESCROW_ONLY_ACTIONS.escrowSettle, ["name", "expectedDeedId", "expectedVersion", "expectedOwnerVersion", "seller", "recipient", "auctionId", "price"]);
  assert.deepEqual([...ESCROW_ISSUE_ACTIONS].sort(), ["escrowSettle", "issueFromTreasury", "issueSubname"]);
});
test("agents are told the subname steps in POA, with the escrow route", () => {
  for (const text of [POA_CHECKOUT_STEPS, MCP_INSTRUCTIONS]) {
    for (const s of ["list-sub", "cancel-sub", "buy-sub", "issueSubname", "/v1/escrow/subnames", "subnameSales"]) assert.ok(text.includes(s), s);
    assert.doesNotMatch(text, /registry units|internal units/i);
  }
  const docs = discoveryDocuments();
  assert.ok(JSON.parse(docs["/openapi.json"].text).paths["/v1/escrow/subnames"], "OpenAPI documents GET /v1/escrow/subnames");
  assert.ok(docs["/llms.txt"].text.includes("buy-sub"));
});
test("subname errors are clear 409s that say nothing moved", () => {
  for (const code of ["ESCROW_SUBNAMES_OFF", "ESCROW_SUB_CLOSED", "ESCROW_SUB_STALE"]) {
    assert.equal(ERROR_CATALOGUE[code].httpStatus, 409);
    assert.match(ERROR_CATALOGUE[code].message, /No POA was moved/);
  }
});
test("POA amounts are exact 6-decimal strings; bad input is refused", () => {
  assert.equal(poaAmount("10"), "10.000000"); assert.equal(poaAmount("2.5"), "2.500000"); assert.equal(poaAmount("0.000001"), "0.000001");
  for (const bad of ["", "0", "-1", "1.0000001", "1e3", "01", "abc", "1,5"]) assert.throws(() => poaAmount(bad), /POA amount/);
});
test("agent requests are unsigned, exact and POA-only", () => {
  const sell = buildSubnameListingPrompt({ parent: "maple", price: "12.5", endpointUrl: "https://poadomains.link" });
  assert.match(sell, /list-sub \{parent:"maple", price:"12\.500000"\}/); assert.match(sell, /cancel-sub/); assert.match(sell, /Only after I approve/);
  const buy = buildSubnamePurchasePrompt({ name: "shop.maple", listing: "a".repeat(64), price: "12.500000", endpointUrl: "https://poadomains.link" });
  assert.match(buy, /Never send more than 12\.500000 POA/); assert.match(buy, /price:"12500000"/); assert.match(buy, /buy-sub \{listing:"a{64}", name:"shop\.maple", amount:"12\.500000"/);
  assert.match(buy, /Do not submit it to \/v1\/intents/);
  for (const t of [sell, buy]) assert.doesNotMatch(t, /registry units|internal units|private key/i);
  assert.throws(() => buildSubnamePurchasePrompt({ name: "x.y", listing: "nothex", price: "1", endpointUrl: "https://x" }));
});
test("owner UI: one emoji button, an ℹ️ description, and no unit wording", () => {
  const html = readFileSync(new URL("../reference-web/index.html", import.meta.url), "utf8");
  const block = html.slice(html.indexOf('id="poaSubnameTools"'), html.indexOf("</div></div>", html.indexOf('id="poaSubnameTools"')));
  assert.match(block, /data-info-description/); assert.match(block, /id="poaSubnameBtn">🧩 /); assert.match(block, /aria-label="Subname price"/);
  assert.doesNotMatch(block, /units/i);
});
