# Public registry view

The Worker publishes a **filtered projection**, not a replayable database export. Native naming remains unavailable (`livePoA:false`). This does not enable native payments or new-name settlement.

## Stored data is untouched

`cloudflare/public-registry-view.ts` contains an explicit hidden-ID inventory for the audited registry identity. It covers the six names, four deeds, four auctions, four bids through their auction references, three offers, sixteen receipts/request indexes, fifteen seed intents and one practice registration. All five seeded accounts **and the practice account's grant-derived balance** are withheld. Associated nonces, references and refund rows are excluded too.

The adapter reads snapshots and constructs new response objects. It never supplies the projection to Engine, persistence, backups or the escrow title adapter. There is no migration, bootstrap change, deletion, state rewrite, binding change, signature or financial operation. The original sequence and hash are returned as integrity metadata of the **complete stored state**, not as hashes/counts of the public subset. `publicView` describes that scope. Registry identity is immutable; replacing the bound namespace/identity requires a new provenance audit, not copying this policy to unknown state. Local fixtures and other registry identities are not production data.

Expected production baseline: sequence **16**, complete-state hash `0f4417675e36054c20540b7fc5e56b328953923a9eaf2866c63177246b7086b1`. Post-deploy reads must match this baseline.

## Hidden names stay unavailable

- State, collections and pagination omit hidden rows and their cursors. Empty public collections are honestly empty, not erased storage.
- Resolve, targeted name reads and quote return **409 `PUBLIC_RECORD_WITHHELD`**, without owner, price, deed, auction or record payload. Case/canonical aliases, equivalent emoji ownership classes and children of hidden parents remain unavailable. There is no quote template that can collide with these stored titles.
- Targeted hidden auction/offer/receipt and seeded nonce reads also return the withholding error. A hidden receipt is **not** `404 UNKNOWN_OUTCOME`; acceptance is conservatively `unknown` to the public caller. Preserve the original packet and do not replace its request ID/nonce or infer that a name is free.
- Preview/submit references are rejected **before** Engine preview/submit and before the escrow title-reservation hook. Old request IDs, accounts, title IDs and exact receipt replays cannot return a hidden receipt. This rejection dispatches no new action; it does not undo or reclassify the original stored action.
- All HTTP MCP tools/resources share this boundary. Metadata witnesses and the domain-purchase prompt check visibility too; malformed signed-tool inputs are still rejected before dispatch. A caller's supplied input is not proof of a public record.
- The UI uses non-authoritative, opaque ownership-class hints to suppress hidden suggestions, old saved cart rows, owner profiles and misleading “available” controls. Backend checks remain authoritative. These hints are not encryption or an authorization mechanism. Unicode spelling tables and the advisory local ideas catalogue are not transaction records.

## Units are not POA

The Engine's automatic **10,000,000-unit onboarding grant is retained unchanged**, avoiding an economic-policy change and preserving internal registration compatibility. It is not money. Public capabilities replace `onboardingGrantPoa` with `onboardingGrantRegistryUnits`, label asset policies as internal registry units, and set `registryUnits.nativePayment:false` / `redeemable:false`. Quotes and other public registry successes carry the same disclosure.

The legacy wire asset ID `POA` is retained solely to preserve existing request shapes and immutable policy/state hashes. It is **not a claim of native POA backing**. UI prices, fields, summaries, cart caps and unsigned agent handoffs say registry units; the advanced registry-fee field is not represented as a native network fee. Terms, discovery and the Pages mirror explain this. Actual POA escrow is a separate service; its code, wallet, policy, financial gates, bindings and limits are unchanged.

## Evidence and production readiness

Regression tests use a small **synthetic structural fixture with public IDs**, not original record contents, production bootstrap, keys, or original balances. They prove nonmutation, hidden lookups, alias/ancestry reservations, pagination and pre-submit guards. A local SQLite DO/RPC seam exercises the production HTTP/MCP gateway and projection without signing or external I/O. Existing real-PoaRegistry runtime coverage remains in place.

The Pages mirror stores no registry snapshot or synthetic demonstration fixture. Live post-checks must independently verify both hosts, REST and MCP, the original full-state hash, empty public collections, held lookups, UI and escrow invariants. A clean view enables honest read-only verification, **not real-payment production tests**: verified native naming/settlement and real-payment new-name issuance are not implemented. No key, secret or flag alone fixes that implementation gap.
