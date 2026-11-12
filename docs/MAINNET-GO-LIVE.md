# Mainnet POA go-live plan (DRAFT — nothing here is enabled)

Status on Nov 11 2026, 6 PM PST (Worker 1b5386f7 at the time of writing): registry sequence 16, stateHash
`0f4417675e36054c20540b7fc5e56b328953923a9eaf2866c63177246b7086b1`, livePoA:false, escrow enabled/not paused but **held**
(ESCROW_PROTOCOL_CHANGED + upstream status timeouts). Each step below needs Max's explicit go, in order, with the evidence
listed. No step is performed by this PR.

| # | Decision | Exact change | Evidence required | Keys / signing |
|---|---|---|---|---|
| 1 | **Repin the PoA protocol** (clears ESCROW_PROTOCOL_CHANGED) | `POA_ESCROW_ENGINE_SHA256` 4e1f5c41… → `5762b0ca3d4b4c9e0176af67c5383dae97de4ce05c947b2deabc256839e433fd`; `POA_ESCROW_PARAMS_SHA256` 82f99476… → `6a5451ccd3109bb861e12dc31788fe368e0f974f89c41b1e4c8bfab178101101` (Worker vars + `cloudflare/escrow-network.ts` defaults + fixtures + deploy precheck expectations). Epoch 67→70 is progression, not a pin. | Publisher-authenticated release/manifest for both artifacts (not just matching hashes), review of transfer/receipt/finality/fee semantics, full escrow/unknown-outcome test pass against the new client. | No keys. Config change only; Max approval. |
| 2 | **Upstream health** | None in our code. `/chain/poa-mainnet-1/api/status` must answer within the 12 s financial deadline with fresh checkpoints; escrow stays held otherwise (by design). | 24 h of healthy status samples, held:false observed on both hosts. | None. |
| 3 | **Escrow limits** | Keep perTx 250000.000000 / daily 1000000.000000, or set new values (Worker vars + precheck). | Max's chosen numbers; treasury float covers worst-case refunds. | None. |
| 4 | **Treasury / escrow wallet** | Confirm `poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf` is Max-controlled; `POA_ESCROW_KEY` stays a secret binding. | Signed message or tiny test transfer proving control (Max does it himself). | **Max's key**; no secret leaves Cloudflare. |
| 5 | **Turn off internal-unit onboarding grants** | Registry engine: stop the automatic 10,000,000-unit issuer→new-signer grant (`src/engine.ts` apply()) for new signers; existing withheld records unchanged. Requires a new engine revision (state-compatible) and a reviewed migration of the issuer balance semantics. | Design review; replay of all journals produces identical sequence/hash up to the switch. | Registry write path change; Max approval. |
| 6 | **Real-POA pricing for new names** | New names/auctions settle only via escrow-credited POA (deposit → credited → bid → settlement pays seller/fee → refunds to original payer, all implemented and tested in escrow). UI/handoff stop offering internal-unit purchases. | Escrow end-to-end on mainnet with a small amount; refund path proven. | **Real POA moves** — Max signs the first test deposit. |
| 7 | **Auction settlement in POA** | Enable settlement with `POA_ESCROW_NETWORK_WRITES=approved-v1` (already set) once 1–6 pass; confirm fee recipient = treasury. | One full mainnet auction with a Max-owned test name: deposit, bid, settle, refund loser. | **Real POA + signing** (escrow key in Worker). |
| 8 | **Refund policy** | Publish refund rules (original payer only, exactly once — already enforced) in ℹ️ and docs. | Test run in step 7. | None. |
| 9 | **livePoA:true** | Only after 1–8. Flip `livePoA` in `src/interface.ts`, `src/api-contract.ts`, `cloudflare/registry.ts`, `cloudflare/network-status.ts`, MCP schema const, discovery text; update handoff ✅/⛔ lines. | All prior steps green for 7 days; both-host post-checks. | Max approval. |
| 10 | **Native on-chain naming** | Not implementable here: the PoA chain does not expose a naming registry. Needs the upstream native naming release; until then names are registry titles paid in POA via escrow. | Upstream announcement + spec. | External dependency. |

Rollback for every step: previous Worker version via worker-gated-production; no registry state rewrite.
