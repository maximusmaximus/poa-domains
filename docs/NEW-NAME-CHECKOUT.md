# POA new-name checkout

Status: **ON** after Max's approval on Nov 13 2026 (t136u, 3:20 PM PT), when the live Worker binding
`POA_ESCROW_NEW_NAMES=approved-v1` is present. `/v1/escrow/capabilities` → `newNameCheckout: {status:"on", priceRule}`.
The committed Wrangler default remains `false`. Payments still follow escrow's current enabled, paused and held state.

## Flow: deposit → credit → issue
1. The buyer signs `intent` {amount}, sends that exact POA amount with the memo `poadomains:<intent>`, then signs `detect` {intent, txid}.
   This is the existing escrow credit (final transfer, exact binding).
2. The buyer signs a registry packet `issueFromTreasury`
   `{name, asset:"POA", price, expectedDeedId:null, expectedVersion:0, metadata}` with `maxTotal:"0"`.
3. The buyer signs the escrow command `issue` {name, amount, registration:<packet>}, sent to `POST /v1/escrow/command`.
   In ONE storage transaction, escrow checks:
   - the flag is on;
   - the network is fresh and escrow is not paused or halted;
   - the per-transaction limit;
   - `amount` equals the schedule price;
   - the buyer's available credit covers the price;
   - the registration was signed by this buyer for this name and price, and its preview succeeds.

   It then debits the buyer, books a READY payout to the treasury, and mints the permanent name
   to the buyer. If anything fails, nothing is debited and nothing is minted.
4. The treasury proceeds pay out through the existing outbox (same caps, holds and daily limit). Any unused credit is
   withdrawn by `withdraw`, which pays only the original payer.

## Pricing rule
Starting POA checkout prices, approved Nov 13 2026: **100.000000 POA** for common/standard names and
**1000.000000 POA** for premium names (1 POA = 1,000,000 micros). These are the escrow `issue` prices;
they are separate from the immutable registry-unit auction reserves, which stay in the stored policy.
Quotes expose the checkout price as `poaPrice`. `/v1/escrow/capabilities`.newNameCheckout and
`/v1/capabilities`.poaNewNamePrices report the same schedule. 1000 POA is within the unchanged
escrow limits (250,000 POA per transaction, 1,000,000 POA per day).

## Safety
- `issueFromTreasury` is not a public action. It is missing from discovery, quotes and prepare, and public submit and
  preview refuse it (`ESCROW_ONLY`). Replay of recorded commits doesn't run admission, so restarts replay it exactly.
- The audited production history (seq 16) contains no such action, so its replay and hash are unchanged.

## Tests
- Escrow unit tests cover: OFF refuses, wrong price, insufficient funds, idempotency, no double issue, atomic failure,
  hold, pause, limit, and engine escrow-only behavior.
- The real workerd/SQLite runtime test covers the full deposit → credit → issue path, restart replay, the treasury
  payout, and the original-payer refund.
