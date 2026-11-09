import { Engine } from "../src/engine.js";
import { Packet } from "../src/auth.js";
import { normalizeName } from "../src/names.js";
import { need } from "../src/core.js";
import { TitleStore } from "./escrow.js";
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
  };
}
