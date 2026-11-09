import test from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const ok = (r: any) => assert.equal(r.status, "succeeded", r.code);

test("sellFixed accepts POA listings and buyFixed transfers ownership", () => {
  const c = setup();
  c.win();
  const sale = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "POA",
    price: "750",
    validUntil: c.clock.now() + 1000,
  });
  ok(sale);
  const offers = Object.values(c.e.snapshot().offers);
  assert.ok(
    offers.some(
      (o: any) =>
        o.id === sale.result.offerId &&
        o.kind === "resale" &&
        o.asset === "POA" &&
        o.price === "750" &&
        !o.cancelled,
    ),
  );
  ok(
    c.send(
      "buyFixed",
      {
        offerId: sale.result.offerId,
        expectedVersion: 1,
        asset: "POA",
        amount: "750",
      },
      c.bob,
    ),
  );
  assert.equal(c.deed("alpha").owner, c.bob.id);
});

test("sellFixed rejects non-POA assets with RESALE_POA_ONLY", () => {
  const c = setup();
  c.win();
  const bad = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "TEST",
    price: "100",
    validUntil: c.clock.now() + 1000,
  });
  assert.equal(bad.status, "rejected");
  assert.equal(bad.code, "RESALE_POA_ONLY");
  assert.equal(
    Object.values(c.e.snapshot().offers).filter((o: any) => o.kind === "resale")
      .length,
    0,
  );
});

test("non-owner cannot list or unlist; owner can cancelOffer", () => {
  const c = setup();
  c.win();
  assert.equal(
    c.send(
      "sellFixed",
      {
        ...c.vp("alpha"),
        asset: "POA",
        price: "100",
        validUntil: c.clock.now() + 1000,
      },
      c.bob,
    ).code,
    "NOT_OWNER",
  );
  const sale = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "POA",
    price: "100",
    validUntil: c.clock.now() + 1000,
  });
  ok(sale);
  assert.equal(
    c.send(
      "cancelOffer",
      { offerId: sale.result.offerId, expectedVersion: 1 },
      c.bob,
    ).code,
    "NOT_SELLER",
  );
  ok(
    c.send("cancelOffer", {
      offerId: sale.result.offerId,
      expectedVersion: 1,
    }),
  );
  assert.equal(c.e.snapshot().offers[sale.result.offerId]!.cancelled, true);
});

test("change price is cancelOffer then sellFixed; stale listing after transfer", () => {
  const c = setup();
  c.win();
  const first = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "POA",
    price: "100",
    validUntil: c.clock.now() + 1000,
  });
  ok(first);
  ok(
    c.send("cancelOffer", {
      offerId: first.result.offerId,
      expectedVersion: 1,
    }),
  );
  const second = c.send("sellFixed", {
    ...c.vp("alpha"),
    asset: "POA",
    price: "222",
    validUntil: c.clock.now() + 1000,
  });
  ok(second);
  assert.equal(c.e.snapshot().offers[second.result.offerId]!.price, "222");
  ok(c.send("transfer", { ...c.vp("alpha"), recipient: c.bob.id }));
  assert.equal(
    c.send(
      "buyFixed",
      {
        offerId: second.result.offerId,
        expectedVersion: 1,
        asset: "POA",
        amount: "222",
      },
      c.carol,
    ).code,
    "STALE_OFFER",
  );
});
