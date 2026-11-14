// Nov 13 2026 (Max t139u): the production registry is POA-only for NEW actions. Every price, bid,
// purchase, resale and refund goes through POA checkout. History, policyHash, registryId and replay are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTION_REGISTRY_ID, POA_ONLY_CLOSED_ACTIONS, poaOnlyRegistry } from "../dist/src/engine.js";
import { ERROR_CATALOGUE } from "../dist/src/errors.js";
import { MCP_INSTRUCTIONS } from "../dist/src/mcp-core.js";
import { discoveryDocuments } from "../dist/src/discovery.js";
import { publicRegistryRoute } from "../dist/public-registry-view.mjs";
import { auditedEngine, get, original } from "./fixtures/audited-engine.mjs";
import { buildCartItem, cartReview, poaNewNamePrice, poaShort, buildPoaCheckoutHandoff, renderPoaCheckoutHandoff } from "../reference-web/shared.js";

const post = (e, path, body) => publicRegistryRoute(e, { method: "POST", path, query: {}, packet: JSON.stringify({ body, signatures: {} }) }, {});
const fault = (fn) => { try { fn(); } catch (error) { return error.code; } return null; };

test("closed set is exactly the unit-moving actions; title actions stay open", () => {
  assert.deepEqual([...POA_ONLY_CLOSED_ACTIONS].sort(),
    ["announceAuction", "bid", "buyFixed", "createChildOffer", "fillChildOffer", "finalize", "sellFixed", "withdrawRefund"]);
  for (const open of ["transfer", "setRecords", "setMetadata", "revokeChild", "cancelOffer", "cancelAuction", "closeNoBid"])
    assert.ok(!POA_ONLY_CLOSED_ACTIONS.includes(open), open);
  assert.equal(poaOnlyRegistry(PRODUCTION_REGISTRY_ID), true);
  assert.equal(poaOnlyRegistry("0".repeat(64)), false, "local registries keep their behavior");
});

test("production preview and submit refuse every closed action with POA_ONLY; nothing is committed", () => {
  const e = auditedEngine(), before = e.stateHash();
  for (const action of POA_ONLY_CLOSED_ACTIONS)
    for (const path of ["/v1/intents/preview", "/v1/intents"])
      assert.equal(fault(() => post(e, path, { action, params: { name: "freshpoaname" } })), "POA_ONLY", action + " " + path);
  // A title action is not refused by the POA rule (it fails later on its own validation instead).
  assert.notEqual(fault(() => post(e, "/v1/intents/preview", { action: "transfer", params: { name: "freshpoaname" } })), "POA_ONLY");
  assert.equal(e.stateHash(), before);
  assert.equal(e.stateHash(), original.stateHash, "history and stored state are byte-identical");
  assert.equal(e.registryId, PRODUCTION_REGISTRY_ID);
});

test("POA_ONLY is a clear, non-retryable 409 pointing to POA checkout", () => {
  const entry = ERROR_CATALOGUE.POA_ONLY;
  assert.equal(entry.httpStatus, 409);
  assert.equal(entry.retryable, false);
  assert.match(entry.message, /POA checkout/);
  assert.match(entry.message, /\/v1\/escrow\/capabilities/);
  assert.match(entry.message, /No registry change was made/);
});

test("production quote gives the POA price and no signable unit plan", () => {
  const e = auditedEngine();
  const q = get(e, "/v1/quote", { name: "newpublicname", action: "announceAuction" });
  assert.equal(q.status, 200);
  assert.equal(q.data.available, true);
  assert.equal(q.data.poaPrice, "100.000000");
  assert.equal(q.data.currency, "POA");
  assert.equal(q.data.blockedBy, "POA_ONLY");
  assert.equal(q.data.params, null);
  assert.equal(q.data.reserve, null);
  assert.equal(q.data.requiredMaxTotal, null);
  assert.equal(q.data.pricing.checkout, "/v1/escrow/capabilities");
  assert.equal(get(e, "/v1/quote", { name: "🦊", action: "announceAuction" }).data.poaPrice, "1000.000000");
});

test("production capabilities show POA pricing only", () => {
  const cap = get(auditedEngine(), "/v1/capabilities").data;
  assert.equal(cap.poaOnly.status, "on");
  assert.deepEqual(cap.poaOnly.newNames, { standard: "100.000000", premium: "1000.000000" });
  for (const action of POA_ONLY_CLOSED_ACTIONS) {
    assert.ok(!Object.hasOwn(cap.actions, action), action);
    assert.ok(!cap.surface.rest.enabledSigningActions.includes(action), action);
  }
  assert.ok(Object.hasOwn(cap.actions, "transfer"));
  assert.equal(cap.assets.POA.kind, "poa");
  assert.equal(cap.assets.POA.premiumReserve, undefined);
  assert.equal(cap.newAccountRegistryUnits, undefined);
  assert.equal(cap.registryUnits, undefined);
  assert.equal(cap.pricing.currency, "POA");
});

test("agent docs and MCP describe the POA path, not internal units", () => {
  const llms = discoveryDocuments()["/llms.txt"].text;
  for (const text of [llms, MCP_INSTRUCTIONS]) {
    assert.match(text, /priced and paid in POA/);
    assert.match(text, /issueFromTreasury/);
    assert.match(text, /\/v1\/escrow\/command/);
    assert.match(text, /POA_ONLY/);
    assert.doesNotMatch(text, /internal units|internal registry units|priced in internal/);
  }
});

test("POA cart: fixed POA price, review catches a taken name, handoff totals exactly", () => {
  const e = auditedEngine(), cap = get(e, "/v1/capabilities", { include: "emoji" }).data, payload = get(e, "/v1/state").data;
  const state = { ...payload.state, time: payload.observedServerTime };
  const a = buildCartItem({ name: "newpublicname", action: "poaCheckout" }, cap, state);
  const b = buildCartItem({ name: "🦊", action: "poaCheckout" }, cap, state);
  assert.equal(a.amount, "100.000000"); assert.equal(b.amount, "1000.000000");
  assert.equal(poaShort(a.amount), "100"); assert.equal(poaNewNamePrice(cap, { tier: "premium" }), "1000.000000");
  assert.match(a.summary, /100 POA with POA checkout/);
  assert.equal(cartReview(a, cap, state).canAcknowledge, true);
  const taken = structuredClone(state); taken.names.newpublicname = { activeId: "x".repeat(64), auctionId: null };
  assert.equal(cartReview(a, cap, taken).canAcknowledge, false);
  assert.equal(cartReview({ ...a, amount: "1.000000" }, cap, state).canAcknowledge, false, "a changed price needs review");
  const handoff = buildPoaCheckoutHandoff([a, b], cap, "https://poadomains.grok.me", payload, 1);
  assert.equal(handoff.totalPrice, "1100.000000");
  assert.equal(handoff.items[1].priceMicros, "1000000000");
  assert.equal(handoff.registryId, PRODUCTION_REGISTRY_ID);
  assert.equal(handoff.unsigned, true);
  const text = renderPoaCheckoutHandoff(handoff);
  assert.match(text, /Total 1100\.000000 POA/);
  assert.match(text, /issueFromTreasury/);
  assert.doesNotMatch(text, /registry units|internal/);
  assert.throws(() => buildPoaCheckoutHandoff([{ ...a, action: "bid" }], cap, "https://poadomains.grok.me", payload, 1));
  assert.throws(() => buildCartItem({ name: "newpublicname", action: "poaCheckout" }, { ...cap, poaOnly: undefined }, state));
});
