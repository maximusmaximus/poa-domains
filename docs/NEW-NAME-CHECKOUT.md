# POA new-name checkout (OFF)

Status: **OFF**. `/v1/escrow/capabilities` reports `newNameCheckout:"off"`; no route accepts a
new-name purchase in POA. Approved direction: Max, Nov 11 2026 (t108s1102).

## Why it is not just a flag flip
Escrow today sells only titles someone already owns (`terms()` needs a seller; settle needs a
seller-signed transfer). A brand-new name has no seller, and the registry `register` action is
paid in internal registry units, which new accounts no longer receive (PR #72).

## Proposed design (each step needs review; the last needs Max)
1. **Engine**: add an escrow-paid issuance path: `register` with `payment:"escrow-poa"` that
   debits 0 internal units. It is only reachable through the escrow hook and is gated by
   sequence, so committed history replays unchanged.
2. **Escrow command `register`** `{name, amount, registration}`: the buyer signs both the escrow
   command and the registry `register` packet. Escrow checks that the name is available, that
   `amount` equals the quoted POA price, and that the buyer's credited balance covers it within
   the limits and the network-health hold. It then debits the buyer and books the amount to the
   treasury as a settled sale (no network write), and submits the buyer's packet atomically.
   On any registry rejection, the full amount goes back to the buyer's available balance.
   Refunds stay original-payer only.
3. **Treasury sweep**: booked treasury proceeds are paid out by the existing payout outbox, under
   the same caps and hold.
4. **UI/handoff/MCP**: show "Buy with POA" only when `newNameCheckout:"on"`.
5. **Tests**: exactly-once over restarts, a hold blocks the purchase, a failed registration
   refunds the buyer, and a double-spend race is rejected.
6. **Turn on**: set `POA_ESCROW_NEW_NAMES=approved-v1` and change `newNameCheckout()`. This
   needs Max's explicit approval after the runtime tests pass.
