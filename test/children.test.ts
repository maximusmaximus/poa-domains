import test from "node:test";
import assert from "node:assert/strict";
import { setup, witness, lease } from "./helpers.js";
import { signBody } from "../src/auth.js";
const ok = (r: any) => assert.equal(r.status, "succeeded", r.code);

test("parent signed listed/open standing fixed-price offers fill without fresh parent signature; uniqueness is atomic", () => {
  const c = setup();
  c.win();
  const offer = c.offer();
  ok(c.fill(offer));
  assert.equal(c.deed("agent.alpha").owner, c.bob.id);
  assert.equal(c.deed("agent.alpha").rights.kind, "permanent");
  const before = c.e.snapshot().balances;
  assert.equal(c.fill(offer, "agent", c.carol).code, "NAME_TAKEN");
  assert.deepEqual(c.e.snapshot().balances, before);
  const open = c.offer({ kind: "permanent" }, null);
  ok(c.fill(open, "🚀", c.carol));
  assert.equal(c.deed("🚀.alpha").owner, c.carol.id);
  assert.equal(c.fill(open, "a.b", c.bob).code, "UNSUPPORTED_NAME");
});
test("parent transfer protects permanent child and lease, invalidates unsold offers, and grants no inherited child control", () => {
  const c = setup();
  c.win();
  const permanent = c.offer();
  ok(c.fill(permanent));
  const r = lease(c.clock.now());
  const leased = c.offer(r, ["rental"]);
  ok(c.fill(leased, "rental", c.carol));
  const oldOffer = c.offer({ kind: "permanent" }, ["unused"]);
  const child = c.deed("agent.alpha"),
    rental = c.deed("rental.alpha");
  ok(c.send("transfer", { ...c.vp("alpha"), recipient: c.carol.id }));
  assert.equal(c.fill(oldOffer, "unused", c.bob).code, "STALE_OFFER");
  assert.deepEqual(c.deed("agent.alpha"), child);
  assert.deepEqual(c.deed("rental.alpha"), rental);
  assert.equal(
    c.send("setRecords", { ...c.vp("agent.alpha"), records: [] }, c.carol).code,
    "NOT_OWNER",
  );
  assert.equal(
    c.send(
      "revokeChild",
      {
        ...c.vp("agent.alpha"),
        parentOwnerVersion: c.deed("alpha").ownerVersion,
      },
      c.carol,
    ).code,
    "NOT_CHILD_HOLDER",
  );
});
test("free child transfer and fixed resale preserve absolute expiry, renewal policy, grace and rights hash", () => {
  const c = setup();
  c.win();
  const o = c.offer(lease(c.clock.now()));
  ok(c.fill(o));
  const d = c.deed("agent.alpha");
  ok(
    c.send(
      "transfer",
      { ...c.vp("agent.alpha"), recipient: c.carol.id },
      c.bob,
    ),
  );
  assert.deepEqual(c.deed("agent.alpha").rights, d.rights);
  assert.equal(c.deed("agent.alpha").expiry, d.expiry);
  assert.equal(c.deed("agent.alpha").rightsHash, d.rightsHash);
  const sale = c.send(
    "sellFixed",
    {
      ...c.vp("agent.alpha"),
      asset: "TEST",
      price: "300",
      validUntil: c.clock.now() + 100,
    },
    c.carol,
  );
  ok(sale);
  ok(
    c.send(
      "buyFixed",
      {
        offerId: sale.result.offerId,
        expectedVersion: 1,
        asset: "TEST",
        amount: "300",
      },
      c.bob,
    ),
  );
  assert.equal(c.deed("agent.alpha").rightsHash, d.rightsHash);
  c.e.assertInvariants();
});
test("root resale auction title lock blocks withdrawal/new grants while sold child rights remain usable", () => {
  const c = setup();
  c.win();
  const o = c.offer();
  ok(c.fill(o));
  const d = c.deed("alpha");
  const r = c.send(
    "announceAuction",
    {
      ...c.vp("alpha"),
      asset: "POA",
      reserve: "500",
      openAt: c.clock.now() + 86400,
      metadata: d.metadata.at(-1),
    },
    c.alice,
  );
  ok(r);
  assert.equal(
    c.send("transfer", { ...c.vp("alpha"), recipient: c.bob.id }).code,
    "TITLE_LOCKED",
  );
  assert.throws(() => c.offer());
  ok(
    c.send(
      "setRecords",
      {
        ...c.vp("agent.alpha"),
        records: [{ type: "service", url: "https://example.invalid/agent" }],
      },
      c.bob,
    ),
  );
  c.clock.advance(86400);
  const id = r.result.auctionId;
  ok(
    c.send(
      "bid",
      {
        auctionId: id,
        expectedVersion: 1,
        asset: "POA",
        amount: "500",
        beneficiary: c.carol.id,
      },
      c.carol,
    ),
  );
  assert.equal(
    c.send("cancelAuction", { auctionId: id, expectedVersion: 2 }).code,
    "HAS_BIDS",
  );
  c.clock.advance(3600);
  ok(c.send("finalize", { auctionId: id, expectedVersion: 2 }, c.bob));
  assert.equal(c.deed("alpha").owner, c.carol.id);
  assert.equal(c.deed("agent.alpha").owner, c.bob.id);
});
test("fixed root resale quotes are invalidated by new child encumbrance, owner change and competing fills", () => {
  const c = setup();
  c.win();
  const sale = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "POA",
    price: "500",
    validUntil: c.clock.now() + 1000,
  });
  ok(sale);
  const o = c.offer();
  ok(c.fill(o));
  assert.equal(
    c.send(
      "buyFixed",
      {
        offerId: sale.result.offerId,
        expectedVersion: 1,
        asset: "POA",
        amount: "500",
      },
      c.carol,
    ).code,
    "STALE_OFFER",
  );
  const fresh = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "POA",
    price: "500",
    validUntil: c.clock.now() + 1000,
  });
  ok(fresh);
  const p = {
    offerId: fresh.result.offerId,
    expectedVersion: 1,
    asset: "POA",
    amount: "500",
  };
  ok(c.send("buyFixed", p, c.carol));
  const before = c.e.snapshot().balances;
  assert.equal(c.send("buyFixed", p, c.bob).code, "STALE_VERSION");
  assert.deepEqual(c.e.snapshot().balances, before);
  assert.equal(c.deed("agent.alpha").owner, c.bob.id);
});
test("guaranteed renewal remains exercisable through parent transfer and resale lock, with asset/price fixed", () => {
  const c = setup();
  c.win();
  const r = lease(c.clock.now());
  const offer = c.offer(r);
  ok(c.fill(offer));
  ok(c.send("transfer", { ...c.vp("alpha"), recipient: c.carol.id }));
  const d = c.deed("alpha");
  const announce = c.send(
    "announceAuction",
    {
      ...c.vp("alpha"),
      asset: "POA",
      reserve: "100",
      openAt: c.clock.now() + 86400,
      metadata: d.metadata.at(-1),
    },
    c.carol,
  );
  ok(announce);
  c.clock.set(r.expiresAt - 500);
  const p = {
    ...c.vp("agent.alpha"),
    asset: "TEST",
    amount: "50",
    termSeconds: 3600,
  };
  assert.equal(c.send("renewLease", p, c.bob).code, "LEASE_ASSET");
  ok(
    c.send(
      "renewLease",
      { ...c.vp("agent.alpha"), asset: "POA", amount: "50", termSeconds: 3600 },
      c.bob,
    ),
  );
  assert.equal(c.deed("agent.alpha").expiry, r.expiresAt + 3600);
  assert.deepEqual(c.deed("agent.alpha").rights, r);
});
for (const resolveDuringGrace of [false, true])
  test(`disclosed grace resolution=${resolveDuringGrace} and no-management policy enforced at exact expiry`, () => {
    const c = setup();
    c.win();
    const r = lease(c.clock.now(), {
      resolveDuringGrace,
      renewal: { kind: "negotiated" },
    });
    const o = c.offer(r);
    ok(c.fill(o));
    c.clock.set(r.expiresAt);
    assert.equal(
      c.send("setRecords", { ...c.vp("agent.alpha"), records: [] }, c.bob).code,
      "LEASE_INACTIVE",
    );
    assert.equal(Boolean(c.e.resolve("agent.alpha").deed), resolveDuringGrace);
    assert.equal(
      c.send("expireLease", c.vp("agent.alpha"), c.carol).code,
      "LEASE_OBLIGATION",
    );
    c.clock.advance(r.graceSeconds);
    ok(c.send("expireLease", c.vp("agent.alpha"), c.carol));
    assert.equal(c.e.resolve("agent.alpha").deed, null);
  });
test("zero grace, permitted grace management and surviving guaranteed option reservation are distinct", () => {
  const c = setup();
  c.win();
  const r = lease(c.clock.now(), { graceSeconds: 0, manageDuringGrace: false });
  const o = c.offer(r);
  ok(c.fill(o));
  c.clock.set(r.expiresAt + 1);
  assert.equal(
    c.send("expireLease", c.vp("agent.alpha"), c.carol).code,
    "LEASE_OBLIGATION",
  );
  assert.equal(c.e.resolve("agent.alpha").deed, null);
  ok(
    c.send(
      "renewLease",
      { ...c.vp("agent.alpha"), asset: "POA", amount: "50", termSeconds: 3600 },
      c.bob,
    ),
  );
  assert.ok(c.e.resolve("agent.alpha").deed);
  const r2 = lease(c.clock.now(), {
    manageDuringGrace: true,
    renewal: { kind: "negotiated" },
  });
  const o2 = c.offer(r2, ["second"]);
  ok(c.fill(o2, "second"));
  c.clock.set(r2.expiresAt);
  ok(c.send("setRecords", { ...c.vp("second.alpha"), records: [] }, c.bob));
});
test("negotiated renewal requires both current holder and parent control, cannot use unilateral parent intent", () => {
  const c = setup();
  c.win();
  const o = c.offer(lease(c.clock.now(), { renewal: { kind: "negotiated" } }));
  ok(c.fill(o));
  const p = {
    ...c.vp("agent.alpha"),
    asset: "POA",
    amount: "90",
    termSeconds: 1000,
  };
  assert.equal(c.send("renewLease", p, c.bob).code, "CONSENT_REQUIRED");
  ok(c.send("renewLease", p, c.bob, {}, [c.alice]));
  assert.equal(c.deed("agent.alpha").renewals, 1);
});
test("consensual revocation requires real holder plus parent signatures; permanent path remains reserved", () => {
  const c = setup();
  c.win();
  const o = c.offer();
  ok(c.fill(o));
  const p = {
    ...c.vp("agent.alpha"),
    parentOwnerVersion: c.deed("alpha").ownerVersion,
  };
  assert.equal(c.send("revokeChild", p, c.bob).code, "CONSENT_REQUIRED");
  ok(c.send("revokeChild", p, c.bob, {}, [c.alice]));
  assert.equal(c.e.resolve("agent.alpha").deed, null);
  const other = c.offer({ kind: "permanent" }, ["agent"]);
  assert.equal(c.fill(other, "agent", c.carol).code, "NAME_TAKEN");
  assert.equal(
    c.send("expireLease", c.vp("agent.alpha"), c.carol).code,
    "PERMANENT_DEED",
  );
});
test("expired lease reallocation increments generation; delayed signed old-deed intent cannot control new deed even for same wallet", () => {
  const c = setup();
  c.win();
  const r = lease(c.clock.now(), {
    graceSeconds: 0,
    renewal: { kind: "negotiated" },
  });
  const o = c.offer(r);
  ok(c.fill(o));
  const original = c.deed("agent.alpha");
  const old = c.packet(
    "setRecords",
    { ...c.vp("agent.alpha"), records: [] },
    c.bob,
    { nonce: c.e.nextNonce(c.bob.id) + 1 },
  );
  c.clock.set(r.expiresAt);
  ok(c.send("expireLease", c.vp("agent.alpha"), c.carol));
  const nextOffer = c.offer({ kind: "permanent" });
  ok(c.fill(nextOffer));
  assert.equal(c.deed("agent.alpha").generation, 2);
  assert.notEqual(c.deed("agent.alpha").id, original.id);
  assert.equal(c.e.submit(old).code, "DEED_GENERATION");
});
test("metadata updates append verified CID history without rewriting rights; unauthorized/stale/invalid updates fail", () => {
  const c = setup();
  c.win();
  const d = c.deed("alpha");
  const m = witness(
    "alpha",
    d.rights,
    null,
    "Updated harmless text <script>do-not-execute</script>",
  );
  ok(c.send("setMetadata", { ...c.vp("alpha"), metadata: m }));
  assert.equal(c.deed("alpha").metadata.length, 2);
  assert.equal(c.deed("alpha").rightsHash, d.rightsHash);
  const before = c.e.snapshot().deeds;
  assert.equal(
    c.send("setMetadata", {
      ...c.vp("alpha"),
      metadata: { ...m, cid: "invalid" },
    }).code,
    "CID",
  );
  assert.equal(
    c.send("setMetadata", { ...c.vp("alpha"), metadata: m }, c.bob).code,
    "NOT_OWNER",
  );
  const wrong = witness("alpha", { kind: "permanent" }, "forged-parent");
  assert.equal(
    c.send("setMetadata", { ...c.vp("alpha"), metadata: wrong }).code,
    "METADATA_BINDING",
  );
  assert.deepEqual(c.e.snapshot().deeds, before);
});
test("typed records reject script/credential URLs and invalid CID, with atomic rollback", () => {
  const c = setup();
  c.win();
  for (const records of [
    [{ type: "service", url: "javascript:alert(1)" }],
    [{ type: "service", url: "https://u:p@example.invalid/" }],
    [
      {
        type: "service",
        url: "https://example.invalid/?token=not-a-credential",
      },
    ],
    [{ type: "ipfs", cid: "not-a-cid" }],
    [null],
  ]) {
    const before = c.e.snapshot().deeds;
    const r = c.send("setRecords", { ...c.vp("alpha"), records });
    assert.equal(r.status, "rejected");
    assert.deepEqual(c.e.snapshot().deeds, before);
  }
  ok(
    c.send("setRecords", {
      ...c.vp("alpha"),
      records: [
        { type: "wallet", chain: "local-fixture", address: c.alice.id },
        { type: "service", url: "https://example.invalid/api" },
        { type: "ipfs", cid: c.deed("alpha").metadata[0]!.cid },
      ],
    }),
  );
});

test("old standing authorization does not revive if the same parent wallet later reacquires root", () => {
  const c = setup();
  c.win();
  const o = c.offer();
  ok(c.send("transfer", { ...c.vp("alpha"), recipient: c.carol.id }));
  ok(c.send("transfer", { ...c.vp("alpha"), recipient: c.alice.id }, c.carol));
  assert.equal(c.deed("alpha").owner, c.alice.id);
  assert.equal(c.deed("alpha").ownerVersion, 3);
  assert.equal(c.fill(o).code, "STALE_OFFER");
});
