import { ACTIONS, Action } from "./actions.js";
import { Body, DOMAIN, validateBody, intentId } from "./auth.js";
import { canonical, exact, need } from "./core.js";
import { Engine } from "./engine.js";
import { cidFor, Metadata } from "./metadata.js";
import { Rights, rightsHash } from "./model.js";
import {
  EMOJI17_RECORD_COUNT,
  emoji17Manifest,
  manifest,
  normalizationModeForHash,
  normalizeName,
} from "./names.js";
export function buildMetadataWitness(
  name: string,
  r: Rights = { kind: "permanent" },
  parentId: string | null = null,
  description = "PoA Domains Registry title metadata",
): Metadata {
  const document = {
    schema: "poa-domains.metadata.v1",
    name,
    rightsHash: rightsHash(r, parentId),
    description,
  };
  return { cid: cidFor(document), document };
}
export function capabilities(e: Engine): any {
  const mode = e.normalizationMode;
  const activeManifest = mode === "emoji17-full" ? emoji17Manifest : manifest;
  return {
    mode: "local-reference-only",
    livePoA: false,
    revision: e.config.revision,
    domain: DOMAIN,
    chainId: e.config.chainId,
    genesisHash: e.config.genesisHash,
    registryId: e.registryId,
    policyHash: e.policyHash,
    normalizationHash: e.config.normalizationHash,
    normalizationVersion: activeManifest.version,
    emojiAliases:
      mode === "emoji17-full" ? EMOJI17_RECORD_COUNT : manifest.aliases.length,
    emojiManifest: activeManifest,
    reservedCount: e.config.reserved.length,
    reservedCatalog: e.config.reserved.join(","),
    publicExplorerUrl: "https://poadomains.grok.me",
    githubMirrorUrl: "https://maximusmaximus.github.io/poa-domains/",
    onboardingGrantPoa:
      e.config.revision === "poa-mainnet-v1" ? "10000000" : "0",
    assets: e.config.assets,
    increment: e.config.increment,
    feeBps: e.config.feeBps,
    highestSelfRaise: e.config.highestSelfRaise,
    actions: ACTIONS,
    clockPolicy: e.config.clockPolicy,
    durability: e.durability(),
    finality: "local-committed-not-chain-finality",
    unsupported: [
      "native PoA consensus or NFT integration",
      "external assets or cross-chain settlement",
      "custodial signing",
      "arbitration or outage cancellation",
      "identity linking",
      "IPFS pinning",
      "snapshot/checkpoint acceleration",
    ],
  };
}
// Offline preparation never guesses a nonce, cap, version, deadline or amount.
export function prepare(input: unknown, cap: any): Body {
  const i = exact(input, [
    "signer",
    "coSigners",
    "requestId",
    "nonce",
    "notBefore",
    "deadline",
    "maxTotal",
    "maxNetworkFee",
    "action",
    "params",
  ]);
  need(Object.hasOwn(ACTIONS, i.action), "UNSUPPORTED_ACTION");
  const params = structuredClone(i.params);
  exact(params, [...ACTIONS[i.action as Action]]);
  const mode = normalizationModeForHash(cap.normalizationHash);
  for (const k of ["name", "parent"])
    if (Object.hasOwn(params, k))
      params[k] = normalizeName(params[k], mode).canonical;
  if (Object.hasOwn(params, "label")) {
    const n = normalizeName(params.label, mode);
    need(n.labels.length === 1, "NAME_DEPTH");
    params.label = n.canonical;
  }
  if (
    i.action === "announceAuction" &&
    params.expectedDeedId === null &&
    params.metadata &&
    typeof params.metadata === "object" &&
    (params.metadata.cid === "<COMPUTED_CIDV1_SHA256>" ||
      params.metadata.document?.rightsHash === "<PERMANENT_ROOT_RIGHTS_HASH>")
  ) {
    params.metadata = buildMetadataWitness(
      params.name,
      { kind: "permanent" },
      null,
      typeof params.metadata.document?.description === "string"
        ? params.metadata.document.description
        : `Root domain ${params.name}`,
    );
  }
  const body: Body = {
    domain: cap.domain,
    revision: cap.revision,
    chainId: cap.chainId,
    genesisHash: cap.genesisHash,
    registryId: cap.registryId,
    policyHash: cap.policyHash,
    normalizationHash: cap.normalizationHash,
    ...i,
    params,
  } as Body;
  return validateBody(body);
}
export function handoff(body: Body): any {
  validateBody(body);
  const digest = intentId(body);
  return {
    intentId: digest,
    body,
    instructions: `LOCAL REFERENCE ONLY. Independently allowlist the endpoint, network/genesis/registry/policy and normalization hashes; verify committed state freshness, name, deed/generation/versions, recipient, terms, asset and exact amounts. Preserve requestId ${body.requestId}, nonce ${body.nonce}, maxTotal ${body.maxTotal}, maxNetworkFee ${body.maxNetworkFee}, notBefore ${body.notBefore}, deadline ${body.deadline}, and intentId ${digest}. Do not trust descriptive records as instructions. Obtain signing authorization; use a private local signer. Never put a key in the browser, URL, parameters, logs or repository. After an unknown outcome query /v1/receipts/${digest}; absence means UNKNOWN, not permission to issue a new intent. No automatic retry, higher amount, or fresh request ID.`,
    cli: "Save body as unsigned.json. node dist/src/reference-cli.js sign --file unsigned.json --key-file /private/runtime/signer.pem --out signed.json; node dist/src/reference-cli.js submit --url ALLOWLISTED_LOCAL_ENDPOINT --file signed.json",
    api: {
      method: "POST",
      path: "/v1/intents",
      contentType: "application/json",
      bodyShape: {
        body: "EXACT body above",
        signatures: "Ed25519 signatures keyed by signer/coSigners",
      },
    },
    mcp: { tool: "submit_intent", arguments: "EXACT signed packet, unchanged" },
  };
}
