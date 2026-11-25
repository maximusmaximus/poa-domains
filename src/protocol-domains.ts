import { KeyObject } from "node:crypto";
import { Body, DOMAIN, Packet, signBody } from "./auth.js";
import { need } from "./core.js";
import { Engine } from "./engine.js";
import { Receipt, rightsHash } from "./model.js";
import { buildProfileWitness } from "./profile.js";
import { BootableSystemClock } from "./seed.js";

export const PUBLIC_PROTOCOL_DOMAIN_NAMES = Object.freeze(["escrow", "treasury"] as const);
export type PublicProtocolDomainName = (typeof PUBLIC_PROTOCOL_DOMAIN_NAMES)[number];

export interface ProtocolDomainSpec {
  readonly name: PublicProtocolDomainName;
  readonly requestId: string;
  readonly description: string;
  readonly poaAddress: (addrs: { treasury: string; escrow: string | null }) => string | null;
}

export const PROTOCOL_DOMAIN_SPECS: readonly ProtocolDomainSpec[] = Object.freeze([
  {
    name: "treasury",
    requestId: "protocol-domain-treasury-v1",
    description:
      "Official PoA Domains Treasury wallet. Holds protocol fee revenue and reserved PoA Domains owned by the registry treasury.",
    poaAddress: ({ treasury }) => treasury,
  },
  {
    name: "escrow",
    requestId: "protocol-domain-escrow-v1",
    description:
      "Official PoA Domains Escrow wallet. Holds buyer deposits, active POA auction bids, and checkout payouts for PoA Domains.",
    poaAddress: ({ escrow }) => escrow,
  },
]);

export interface ProvisionedProtocolDomain {
  name: PublicProtocolDomainName;
  packet: Packet;
  receipt: Receipt;
}

/**
 * Idempotently claim official reserved protocol names ("treasury", "escrow") under the
 * registry's treasury principal with v1 profiles pointing to each respective POA address.
 */
export function provisionProtocolDomains(
  engine: Engine,
  clock: BootableSystemClock,
  treasuryKey: KeyObject,
  escrowAddress: string | null,
): ProvisionedProtocolDomain[] {
  const treasury = engine.config.treasury;
  const rootRightsHash = rightsHash({ kind: "permanent" }, null);
  const provisioned: ProvisionedProtocolDomain[] = [];
  const prevOverride = clock.overrideTime;
  try {
    for (const spec of PROTOCOL_DOMAIN_SPECS) {
      const targetPoa = spec.poaAddress({ treasury, escrow: escrowAddress });
      if (!targetPoa) continue;
      const snap = engine.snapshot();
      if (snap.names[spec.name]?.activeId) continue;
      const nowSec = Math.max(Math.floor(Date.now() / 1000), snap.time);
      clock.overrideTime = nowSec;
      const profileWitness = buildProfileWitness({
        name: spec.name,
        rightsHash: rootRightsHash,
        poa: targetPoa,
        description: spec.description,
      });
      const body: Body = {
        domain: DOMAIN,
        revision: engine.config.revision,
        chainId: engine.config.chainId,
        genesisHash: engine.config.genesisHash,
        registryId: engine.registryId,
        policyHash: engine.policyHash,
        normalizationHash: engine.config.normalizationHash,
        signer: treasury,
        coSigners: [],
        requestId: spec.requestId,
        nonce: engine.nextNonce(treasury),
        notBefore: 0,
        deadline: nowSec + 600,
        maxTotal: "0",
        maxNetworkFee: "0",
        action: "issueReserved",
        params: {
          name: spec.name,
          expectedVersion: 0,
          expectedDeedId: null,
          metadata: profileWitness,
        },
      };
      const packet = signBody(body, [treasuryKey]);
      const receipt = engine.submit(packet);
      need(receipt.status === "succeeded", receipt.code);
      provisioned.push({ name: spec.name, packet, receipt });
    }
  } finally {
    clock.overrideTime = prevOverride;
  }
  return provisioned;
}
