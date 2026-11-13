import { Engine } from "../src/engine.js";
import { Packet } from "../src/auth.js";
import { normalizeName } from "../src/names.js";
import { need } from "../src/core.js";
import { TitleStore } from "./escrow.js";
import { poaNewNamePriceMicros } from "../src/new-name-prices.js";
export function registryTitles(e: Engine): TitleStore {
  need(e.config.increment.kind === "eosStrict10", "ESCROW_INCREMENT_POLICY");
  return {
      terms: (name, seller) => {
        const s = e.snapshot(), d = s.deeds[s.names[name]?.activeId ?? ""];
        need(d && d.owner === seller && !d.lock && d.rights.kind === "permanent" && !d.retired, "ESCROW_TITLE");
        need(!Object.values(s.offers).some(o => o.parentId === d.id && !o.cancelled && o.uses < o.maxUses), "ESCROW_ENCUMBERED_TITLE");
        const premium = normalizeName(name, e.normalizationMode).tier === "premium";
        return { reserve: "0.000001", window: premium ? 86400000 : 3600000, quiet: premium ? 86400000 : 3600000 };
      },
      validate: (packet: Packet, name, seller, buyer) => {
        need(packet.body.action === "transfer" && packet.body.signer === seller && packet.body.params.name === name &&
          packet.body.params.recipient === buyer && packet.body.maxTotal === "0" && packet.body.maxNetworkFee === "0", "ESCROW_TITLE_CONSENT");
        need(e.preview(packet).status === "succeeded", "ESCROW_TITLE_NOT_READY");
      },
      commit: (packet: Packet) => { need(e.submit(packet).status === "succeeded", "ESCROW_TITLE_COMMIT"); },
      // POA new-name checkout. Explicit schedule, not the immutable registry auction reserve:
      // standard/common 100.000000 POA, premium 1000.000000 POA (1 POA = 1,000,000 micros).
      issueTerms: (name) => {
        const s = e.snapshot(), row = s.names[name];
        need(!row?.activeId && !row?.auctionId, "ESCROW_NAME_TAKEN");
        const n = normalizeName(name, e.normalizationMode), a = e.config.assets.POA;
        need(a && n.labels.length === 1, "ESCROW_ISSUE_NAME");
        return { price: poaNewNamePriceMicros(n.tier === "premium" ? "premium" : "standard") };
      },
      validateIssue: (packet: Packet, name, buyer, price) => {
        const b = packet.body, q = b.params as Record<string, unknown>;
        need(b.action === "issueFromTreasury" && b.signer === buyer && q.name === name && q.asset === "POA" &&
          q.price === price && q.expectedDeedId === null && q.expectedVersion === 0 &&
          b.maxTotal === "0" && b.maxNetworkFee === "0" && b.coSigners.length === 0, "ESCROW_ISSUE_CONSENT");
        need(e.previewEscrowIssue(packet).status === "succeeded", "ESCROW_ISSUE_NOT_READY");
      },
      issue: (packet: Packet) => { need(e.submitEscrowIssue(packet).status === "succeeded", "ESCROW_ISSUE_COMMIT"); },
  };
}
