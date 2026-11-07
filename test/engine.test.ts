import test from "node:test";
import assert from "node:assert/strict";
import { setup, witness, lease } from "./helpers.js";
import { hash, MAX_AMOUNT } from "../src/core.js";
import { minimumNext } from "../src/config.js";
import { signBody } from "../src/auth.js";
const ok = (r: any) => assert.equal(r.status, "succeeded", r.code);

test("auction announcement requires canonical name, reserve policy and 24-hour notice; no mint on bid", () => {
  const c = setup();
  const params = {
    name: "alpha",
    asset: "POA",
    reserve: "100",
    openAt: c.clock.now() + 86399,
    expectedDeedId: null,
    expectedVersion: 0,
    metadata: witness("alpha"),
  };
  assert.equal(c.send("announceAuction", params, c.issuer).code, "INTEGER");
  const id = c.announce();
  assert.equal(Object.keys(c.e.snapshot().deeds).length, 0);
  c.clock.advance(86400);
  ok(
    c.send("bid", {
      auctionId: id,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.alice.id,
    }),
  );
  assert.equal(c.e.resolve("alpha").deed, null);
  assert.equal(Object.keys(c.e.snapshot().deeds).length, 0);
});
for (const [name, w] of [
  ["alpha", 3600],
  ["abc", 86400],
] as const)
  test(`first late bid extends full ${w}-second quiet window, independent of other names`, () => {
    const c = setup();
    const id = c.announce(name);
    const other = c.announce("other");
    const a = c.e.snapshot().auctions[id]!;
    assert.equal(a.window, w);
    assert.equal(a.quiet, w);
    c.clock.set(a.openAt + w - 1);
    ok(
      c.send("bid", {
        auctionId: id,
        expectedVersion: 1,
        asset: "POA",
        amount: a.reserve,
        beneficiary: c.alice.id,
      }),
    );
    const high = c.e.snapshot().auctions[id]!;
    assert.equal(c.e.closeEligible(high), a.openAt + 2 * w - 1);
    assert.equal(
      c.send("finalize", { auctionId: id, expectedVersion: 2 }, c.bob).code,
      "QUIET_PERIOD",
    );
    c.clock.set(
      Math.max(
        c.clock.now(),
        c.e.closeEligible(c.e.snapshot().auctions[other]!),
      ),
    );
    ok(c.send("closeNoBid", { auctionId: other, expectedVersion: 1 }, c.carol));
    c.clock.set(c.e.closeEligible(high));
    assert.equal(
      c.send(
        "bid",
        {
          auctionId: id,
          expectedVersion: 2,
          asset: "POA",
          amount: "2000",
          beneficiary: c.bob.id,
        },
        c.bob,
      ).code,
      "AUCTION_CLOSED",
    );
    ok(c.send("finalize", { auctionId: id, expectedVersion: 2 }, c.bob));
    assert.equal(c.deed(name).owner, c.alice.id);
  });
test("strict raise, seller self-bid, high self-raise and unsupported/mismatched assets fail without debit or extension", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  ok(
    c.send("bid", {
      auctionId: id,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.alice.id,
    }),
  );
  for (const [who, asset, amount, beneficiary, code] of [
    [c.bob, "POA", "110", c.bob.id, "MIN_RAISE"],
    [c.alice, "POA", "111", c.alice.id, "HIGH_SELF_RAISE"],
    [c.bob, "TEST", "111", c.bob.id, "AUCTION_ASSET"],
    [c.bob, "NOPE", "111", c.bob.id, "UNSUPPORTED_ASSET"],
    [c.bob, "POA", "111", c.treasury.id, "SELLER_SELF_BID"],
  ] as const) {
    const before = c.e.snapshot();
    assert.equal(
      c.send(
        "bid",
        { auctionId: id, expectedVersion: 2, asset, amount, beneficiary },
        who,
      ).code,
      code,
    );
    assert.deepEqual(c.e.snapshot().balances, before.balances);
    assert.deepEqual(c.e.snapshot().auctions, before.auctions);
  }
});
test("simultaneous stale-version bids serialize: one winner, loser pays nothing; current state minimum is rechecked", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  const p = {
    auctionId: id,
    expectedVersion: 1,
    asset: "POA",
    amount: "100",
    beneficiary: c.alice.id,
  };
  const one = c.packet("bid", p),
    two = c.packet("bid", { ...p, beneficiary: c.bob.id }, c.bob);
  const before = c.e.snapshot().balances[c.bob.id]!.POA;
  ok(c.e.submit(one));
  assert.equal(c.e.submit(two).code, "STALE_VERSION");
  assert.equal(c.e.snapshot().balances[c.bob.id]!.POA, before);
  assert.equal(
    c.send(
      "bid",
      { ...p, expectedVersion: 2, amount: "110", beneficiary: c.bob.id },
      c.bob,
    ).code,
    "MIN_RAISE",
  );
});
test("full displaced refunds are independently available before close, cannot double withdraw, and stay bound to payer", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  ok(
    c.send("bid", {
      auctionId: id,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.carol.id,
    }),
  );
  ok(
    c.send(
      "bid",
      {
        auctionId: id,
        expectedVersion: 2,
        asset: "POA",
        amount: "111",
        beneficiary: c.bob.id,
      },
      c.bob,
    ),
  );
  const credit = Object.values(c.e.snapshot().credits)[0]!;
  assert.equal(credit.amount, "100");
  assert.equal(credit.payer, c.alice.id);
  assert.equal(c.e.resolve("alpha").deed, null);
  const params = {
    auctionId: id,
    asset: "POA",
    expectedVersion: 1,
    amount: "100",
  };
  const packet = c.packet("withdrawRefund", params);
  const receipt = c.e.submit(packet);
  ok(receipt);
  assert.deepEqual(c.e.submit(packet), receipt);
  assert.equal(
    c.send("withdrawRefund", { ...params, expectedVersion: 2 }).code,
    "REFUND_EXCEEDED",
  );
  assert.equal(c.send("withdrawRefund", params, c.carol).code, "NO_REFUND");
  assert.equal(
    c.e.snapshot().balances[c.alice.id]!.POA,
    c.config.balances[c.alice.id]!.POA,
  );
  c.e.assertInvariants();
});
test("finalize exactly once atomically mints permanent title and fee/proceeds; no new winning debit", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  ok(
    c.send("bid", {
      auctionId: id,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.carol.id,
    }),
  );
  const buyerBalance = c.e.snapshot().balances[c.alice.id]!.POA;
  c.clock.advance(3600);
  const p = c.packet("finalize", { auctionId: id, expectedVersion: 2 }, c.bob);
  const r = c.e.submit(p);
  ok(r);
  const state = c.e.stateHash();
  assert.deepEqual(c.e.submit(p), r);
  assert.equal(c.e.stateHash(), state);
  assert.equal(c.deed("alpha").owner, c.carol.id);
  assert.equal(c.deed("alpha").rights.kind, "permanent");
  assert.equal(c.deed("alpha").expiry, null);
  assert.equal(c.e.snapshot().balances[c.alice.id]!.POA, buyerBalance);
  assert.equal(
    c.send("finalize", { auctionId: id, expectedVersion: 3 }).code,
    "AUCTION_TERMINAL",
  );
});
test("no-bid close releases reservation; reoffer has new ID and another 24h notice, no floor sale", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400 + 3600);
  ok(c.send("closeNoBid", { auctionId: id, expectedVersion: 1 }));
  assert.equal(Object.keys(c.e.snapshot().deeds).length, 0);
  const other = c.announce();
  assert.notEqual(other, id);
  assert.equal(c.e.snapshot().auctions[other]!.openAt, c.clock.now() + 86400);
});
test("pre-open seller cancellation releases lock; no cancellation after a bid", () => {
  const c = setup();
  const id = c.announce();
  ok(c.send("cancelAuction", { auctionId: id, expectedVersion: 1 }, c.issuer));
  const next = c.announce();
  c.clock.advance(86400);
  ok(
    c.send("bid", {
      auctionId: next,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.alice.id,
    }),
  );
  assert.equal(
    c.send("cancelAuction", { auctionId: next, expectedVersion: 2 }, c.issuer)
      .code,
    "HAS_BIDS",
  );
});
test("insufficient funds and cap failures roll back all economic effects", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  for (const [amount, cap, code] of [
    ["100", "99", "AMOUNT_CAP"],
    ["1000000000001", "1000000000001", "INSUFFICIENT_FUNDS"],
  ] as const) {
    const state = c.e.snapshot();
    assert.equal(
      c.send(
        "bid",
        {
          auctionId: id,
          expectedVersion: 1,
          asset: "POA",
          amount,
          beneficiary: c.alice.id,
        },
        c.alice,
        { maxTotal: cap },
      ).code,
      code,
    );
    assert.deepEqual(c.e.snapshot().balances, state.balances);
    assert.deepEqual(c.e.snapshot().auctions, state.auctions);
  }
});
test("amounts beyond Number safe range settle exactly, with bounded overflow rejected", () => {
  const c = setup((config) => {
    for (const id of Object.keys(config.balances))
      config.balances[id]!.POA = "2000000000000000000";
  });
  const id = c.announce();
  c.clock.advance(86400);
  const bid = "9007199254740993";
  ok(
    c.send(
      "bid",
      {
        auctionId: id,
        expectedVersion: 1,
        asset: "POA",
        amount: bid,
        beneficiary: c.alice.id,
      },
      c.alice,
      { maxTotal: bid },
    ),
  );
  assert.equal(
    c.e.snapshot().balances[c.alice.id]!.POA,
    (2000000000000000000n - BigInt(bid)).toString(),
  );
  const before = c.e.snapshot().balances;
  assert.equal(
    c.send(
      "bid",
      {
        auctionId: id,
        expectedVersion: 2,
        asset: "POA",
        amount: (MAX_AMOUNT + 1n).toString(),
        beneficiary: c.bob.id,
      },
      c.bob,
    ).code,
    "AMOUNT",
  );
  assert.deepEqual(c.e.snapshot().balances, before);
});
test("model/property: 200 seeded bid/invalid/refund steps conserve exact per-asset wealth and match independent escrow/refund model", () => {
  const c = setup();
  const id = c.announce();
  c.clock.advance(86400);
  const actors = [c.alice, c.bob, c.carol];
  const balances = new Map(actors.map((x) => [x.id, 1000000000000n]));
  const credits = new Map(actors.map((x) => [x.id, 0n]));
  let high = 0n,
    payer = "",
    version = 1,
    seed = 12345;
  for (let i = 0; i < 200; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const who = actors[seed % 3]!;
    const a = c.e.snapshot().auctions[id]!;
    if (i % 4 === 0 && (credits.get(who.id) ?? 0n) > 0n) {
      const credit = Object.values(c.e.snapshot().credits).find(
        (x) => x.payer === who.id,
      )!;
      const n = credits.get(who.id)!;
      ok(
        c.send(
          "withdrawRefund",
          {
            auctionId: id,
            asset: "POA",
            expectedVersion: credit.version,
            amount: n.toString(),
          },
          who,
        ),
      );
      balances.set(who.id, balances.get(who.id)! + n);
      credits.set(who.id, 0n);
    } else {
      const next = high === 0n ? 100n : minimumNext(high, c.config.increment);
      const n = i % 5 === 0 && high > 0n ? high : next;
      const enough = balances.get(who.id)! >= n;
      const valid = who.id !== payer && n >= next && enough;
      const r = c.send(
        "bid",
        {
          auctionId: id,
          expectedVersion: a.version,
          asset: "POA",
          amount: n.toString(),
          beneficiary: who.id,
        },
        who,
      );
      assert.equal(r.status, valid ? "succeeded" : "rejected");
      if (valid) {
        balances.set(who.id, balances.get(who.id)! - n);
        if (payer) credits.set(payer, credits.get(payer)! + high);
        high = n;
        payer = who.id;
        version++;
      }
    }
    for (const who of actors) {
      assert.equal(
        BigInt(c.e.snapshot().balances[who.id]!.POA!),
        balances.get(who.id),
      );
      assert.equal(
        Object.values(c.e.snapshot().credits)
          .filter((x) => x.payer === who.id)
          .reduce((n, x) => n + BigInt(x.amount), 0n),
        credits.get(who.id),
      );
    }
    assert.equal(c.e.snapshot().auctions[id]!.version, version);
    c.e.assertInvariants();
    c.clock.advance(1);
  }
});
