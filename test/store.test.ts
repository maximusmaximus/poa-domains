import { hash } from "../src/core.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/engine.js";
import { attachJournal } from "../src/store.js";
import { setup } from "./helpers.js";

test("full replay/restart preserves every table, clock, outcome, nonce and idempotency binding", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-replay-"));
  const c = setup();
  attachJournal(c.e, dir);
  try {
    c.win();
    const o = c.offer();
    assert.equal(c.fill(o).status, "succeeded");
    const rejected = c.packet(
      "transfer",
      { ...c.vp("alpha"), recipient: c.bob.id },
      c.bob,
    );
    const receipt = c.e.submit(rejected);
    assert.equal(receipt.status, "rejected");
    const state = c.e.snapshot(),
      root = c.e.stateHash();
    c.e.close();
    const restored = new Engine(c.config, c.clock);
    attachJournal(restored, dir);
    try {
      assert.deepEqual(restored.snapshot(), state);
      assert.equal(restored.stateHash(), root);
      assert.deepEqual(restored.submit(rejected), receipt);
      restored.assertInvariants();
    } finally {
      restored.close();
    }
  } finally {
    c.e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("torn unterminated tail is truncated; acknowledged complete records survive recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-tail-"));
  const c = setup();
  attachJournal(c.e, dir);
  try {
    c.announce();
    const root = c.e.stateHash();
    c.e.close();
    const file = join(dir, "events.jsonl");
    const size = readFileSync(file).length;
    appendFileSync(file, '{"partial":');
    const restored = new Engine(c.config, c.clock);
    attachJournal(restored, dir);
    try {
      assert.equal(restored.stateHash(), root);
      assert.equal(readFileSync(file).length, size);
    } finally {
      restored.close();
    }
  } finally {
    c.e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("complete corrupt journal line fails closed, never skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-corrupt-"));
  const c = setup();
  attachJournal(c.e, dir);
  try {
    c.announce();
    c.e.close();
    const file = join(dir, "events.jsonl");
    const record = JSON.parse(readFileSync(file, "utf8").trim());
    record.checksum = "0".repeat(64);
    writeFileSync(file, JSON.stringify(record) + "\n");
    const restored = new Engine(c.config, c.clock);
    assert.throws(() => attachJournal(restored, dir), /JOURNAL_CORRUPT/);
  } finally {
    c.e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("exclusive writer lock and immutable config manifest prevent concurrent writers or silent policy changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-lock-"));
  const c = setup();
  attachJournal(c.e, dir);
  try {
    assert.throws(
      () => attachJournal(new Engine(c.config, c.clock), dir),
      /WRITER_LOCKED/,
    );
    c.e.close();
    const changed = structuredClone(c.config);
    changed.feeBps = 0;
    assert.throws(
      () => attachJournal(new Engine(changed, c.clock), dir),
      /MANIFEST_MISMATCH/,
    );
  } finally {
    c.e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("durability failure returns unknown and halts writes, rather than acknowledging or retrying", () => {
  const c = setup();
  c.e.attach({
    append: () => {
      throw Error("simulated fsync failure");
    },
    close: () => {},
  });
  const packet = c.packet("closeNoBid", {
    auctionId: "missing",
    expectedVersion: 1,
  });
  const before = c.e.stateHash();
  assert.throws(() => c.e.submit(packet), /DURABILITY_UNKNOWN/);
  assert.equal(c.e.stateHash(), before);
  assert.throws(() => c.e.submit(packet), /ENGINE_STOPPED/);
});
test("backward authoritative time fails closed and client timestamp is not an ordering authority", () => {
  const c = setup();
  let t = c.clock.now();
  const e = new Engine(c.config, { now: () => t });
  const packet = c.packet("closeNoBid", {
    auctionId: "missing",
    expectedVersion: 1,
  });
  e.submit(packet);
  t--;
  const second = c.packet(
    "closeNoBid",
    { auctionId: "missing", expectedVersion: 1 },
    c.bob,
  );
  assert.throws(() => e.submit(second), /CLOCK_BACKWARD/);
  assert.equal(e.nextNonce(c.bob.id), 0);
  const id = c.announce();
  c.clock.advance(86400);
  const before = c.e.snapshot().auctions;
  assert.equal(
    c.send("bid", {
      auctionId: id,
      expectedVersion: 1,
      asset: "POA",
      amount: "100",
      beneficiary: c.alice.id,
      timestamp: 0,
    }).code,
    "SCHEMA",
  );
  assert.deepEqual(c.e.snapshot().auctions, before);
});

test("validly checksummed duplicate journal sequence is still rejected by replay ordering", () => {
  const dir = mkdtempSync(join(tmpdir(), "poa-duplicate-seq-"));
  const c = setup();
  attachJournal(c.e, dir);
  try {
    c.announce();
    c.e.close();
    const file = join(dir, "events.jsonl");
    const first = JSON.parse(readFileSync(file, "utf8").trim());
    const next = {
      previous: first.checksum,
      commit: first.commit,
      checksum: hash("journal-record/v1", [first.checksum, first.commit]),
    };
    appendFileSync(file, JSON.stringify(next) + "\n");
    const restored = new Engine(c.config, c.clock);
    assert.throws(() => attachJournal(restored, dir), /REPLAY_ORDER/);
  } finally {
    c.e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
