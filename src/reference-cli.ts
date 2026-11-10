#!/usr/bin/env node
import { quoteAction } from "./quote-client.js";
import { cliFailure } from './cli-errors.js';
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createPrivateKey, generateKeyPairSync, KeyObject } from "node:crypto";
import { parseArgs } from "node:util";
import { Fault, need, parseJSON } from "./core.js";
import { request, endpoint } from "./client.js";
import { buildMetadataWitness, prepare, handoff } from "./interface.js";
import {
  nativePrincipal,
  publicPrincipal,
  validateBody,
  signBody,
} from "./auth.js";
import { Engine } from "./engine.js";
import { SystemClock } from "./clock.js";
import { attachJournal } from "./store.js";
import { startReferenceServer } from "./reference-server.js";
import { runReferenceMcp } from "./reference-mcp.js";

function loadKeyFiles(paths: string[] | undefined): KeyObject[] {
  need(paths?.length && paths.length <= 4, "KEY_FILE_REQUIRED");
  return paths.map((path) => {
    const st = statSync(path);
    need(
      st.isFile() &&
        st.size <= 8192 &&
        (process.platform === "win32" || (st.mode & 0o077) === 0),
      "KEY_FILE_PERMISSIONS",
    );
    const key = createPrivateKey(readFileSync(path));
    need(key.asymmetricKeyType === "ed25519", "KEY_SCHEME");
    return key;
  });
}

async function resolveInputMetadata(raw: any, baseUrl: string): Promise<any> {
  const cloned = structuredClone(raw);
  if (
    cloned?.action === "fillChildOffer" &&
    cloned?.params?.metadata &&
    (cloned.params.metadata.cid === "<COMPUTED_CIDV1_SHA256>" ||
      cloned.params.metadata.document?.rightsHash ===
        "<PARENT_OFFER_RIGHTS_HASH>")
  ) {
    const {offer,parentDeed} = await request(baseUrl, "/v1/offers/"+encodeURIComponent(cloned.params.offerId));
    if (offer && parentDeed) {
      const fullName = `${cloned.params.label}.${parentDeed.name}`;
      cloned.params.metadata = buildMetadataWitness(
        fullName,
        offer.rights ?? { kind: "permanent" },
        offer.parentId,
        cloned.params.metadata.document?.description ??
          `Child domain ${fullName}`,
      );
    }
  }
  return cloned;
}

try {
  const { positionals, values: v } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      file: { type: "string" },
      out: { type: "string" },
      "key-file": { type: "string", multiple: true },
      config: { type: "string" },
      data: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      "public-url": { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      signer: { type: "string" },
      action: { type: "string" },
      params: { type: "string" },
      "max-total": { type: "string" },
      "request-id": { type: "string" },
      "parent-id": { type: "string" },
      description: { type: "string" },
    },
  });
  const cmd = positionals[0];
  need(positionals.length === 1, "COMMAND");
  const input = () => {
    need(v.file, "FILE_REQUIRED");
    return parseJSON(readFileSync(v.file, "utf8"));
  };
  const url = () => {
    need(v.url, "URL_REQUIRED");
    return endpoint(v.url);
  };
  const output = (x: any) => {
    const text = JSON.stringify(x, null, 2) + "\n";
    if (v.out) writeFileSync(v.out, text, { flag: "wx", mode: 0o600 });
    else process.stdout.write(text);
  };
  if (cmd === "keygen") {
    let key: KeyObject;
    let keyFile: string | null = null;
    if (v["key-file"]?.length) {
      key = loadKeyFiles(v["key-file"])[0]!;
      keyFile = v["key-file"][0]!;
    } else {
      key = generateKeyPairSync("ed25519").privateKey;
      if (v.out) {
        writeFileSync(v.out, key.export({ format: "pem", type: "pkcs8" }), {
          flag: "wx",
          mode: 0o600,
        });
        keyFile = v.out;
      }
    }
    const info = {
      principal: nativePrincipal(key),
      legacyPrincipal: publicPrincipal(key),
      keyFile,
    };
    process.stdout.write(JSON.stringify(info, null, 2) + "\n");
  } else if (cmd === "witness") {
    need(v.name, "NAME_REQUIRED");
    output(
      buildMetadataWitness(
        v.name,
        { kind: "permanent" },
        v["parent-id"] ?? null,
        v.description ?? `PoA Domains metadata for ${v.name}`,
      ),
    );
  } else if (cmd === "prepare") {
    const baseUrl = url();
    const resolvedInput = await resolveInputMetadata(input(), baseUrl);
    output(prepare(resolvedInput, await request(baseUrl, "/v1/capabilities")));
  } else if (cmd === "handoff") output(handoff(validateBody(input())));
  else if (cmd === "sign") {
    const body = validateBody(input());
    // Files are read only by the operator's local process. Key bytes never leave it.
    const keys = loadKeyFiles(v["key-file"]);
    output(signBody(body, keys));
  } else if (cmd === "act") {
    const baseUrl = url();
    const keys = loadKeyFiles(v["key-file"]);
    const primaryKey = keys[0]!;
    need(v.action && v.params, "ACTION_AND_PARAMS_REQUIRED");
    const cap = await request(baseUrl, "/v1/capabilities");
    const signer =
      v.signer ??
      (cap.revision === "poa-mainnet-v1"
        ? nativePrincipal(primaryKey)
        : publicPrincipal(primaryKey));
    const parsedParams = parseJSON(v.params);
    const {observedServerTime:now} = await request(baseUrl, "/v1/time");
    let nonce = (await request(baseUrl, "/v1/nonce?signer="+encodeURIComponent(signer))).nonce as number;
    const baseReqId = v["request-id"] ?? `act-${now}-${nonce}`;
    const submitQuoted=async(action:string,params:Record<string,any>,requestId:string)=>{
      const plan=await quoteAction(baseUrl,action,params,signer);
      const maxTotal=v["max-total"]??plan.params.amount??plan.requiredMaxTotal;
      need(typeof maxTotal==="string","QUOTE_INPUT_REQUIRED");
      const body=prepare({signer,coSigners:[],requestId,nonce:nonce++,notBefore:0,
        deadline:plan.observedServerTime+3600,maxTotal,maxNetworkFee:"0",action,params:plan.params},cap);
      return request(baseUrl,"/v1/intents",signBody(body,keys));
    };
    if(v.action === "announceAuction+bid") {
      const announceParams:Record<string,any>={name:parsedParams.name};
      for(const field of ["asset","reserve","openAt","metadata"]) if(parsedParams[field]!==undefined)announceParams[field]=parsedParams[field];
      const announceReceipt=await submitQuoted("announceAuction",announceParams,`${baseReqId}-announce`);
      if(announceReceipt.status!=="succeeded"||cap.revision!=="poa-mainnet-v1") output({announceReceipt});
      else {
        const bidParams:Record<string,any>={auctionId:announceReceipt.result.auctionId,beneficiary:signer};
        if(parsedParams.maxBid!==undefined)bidParams.amount=parsedParams.maxBid;
        const bidReceipt=await submitQuoted("bid",bidParams,`${baseReqId}-bid`);
        output({status:bidReceipt.status,auctionId:announceReceipt.result.auctionId,announceReceipt,bidReceipt});
      }
    } else {
      const resolved=await resolveInputMetadata({action:v.action,params:parsedParams},baseUrl);
      output(await submitQuoted(v.action,resolved.params,baseReqId));
    }
  } else if (cmd === "submit")
    output(await request(url(), "/v1/intents", input()));
  else if (cmd === "time") output(await request(url(), "/v1/time"));
  else if (cmd === "quote") {
    need(v.name&&v.action,"NAME_REQUIRED");
    output(await request(url(),"/v1/quote?"+new URLSearchParams({name:v.name,action:v.action,...(v.signer?{signer:v.signer}:{})})));
  }
  else if (cmd === "capabilities")
    output(await request(url(), "/v1/capabilities"));
  else if (cmd === "state" || cmd === "export")
    output(await request(url(), "/v1/state"));
  else if (cmd === "resolve") {
    need(v.name, "NAME_REQUIRED");
    output(
      await request(url(), "/v1/resolve?name=" + encodeURIComponent(v.name)),
    );
  } else if (cmd === "receipt") {
    need(v.id && /^[0-9a-f]{64}$/.test(v.id), "INTENT_ID");
    output(await request(url(), "/v1/receipts/" + v.id));
  } else if (cmd === "nonce") {
    need(v.signer, "PRINCIPAL");
    output(
      await request(url(), "/v1/nonce?signer=" + encodeURIComponent(v.signer)),
    );
  } else if (cmd === "mcp") await runReferenceMcp(url());
  else if (cmd === "serve") {
    need(v.config && v.data, "CONFIG_AND_DATA_REQUIRED");
    const e = new Engine(
      parseJSON(readFileSync(v.config, "utf8"), 262144, 4096),
      new SystemClock(),
    );
    attachJournal(e, v.data);
    try {
      const port = Number(v.port ?? "8787");
      need(Number.isInteger(port) && port >= 0 && port <= 65535, "PORT");
      const s = await startReferenceServer(e, port, {
        host: v.host,
        publicUrl: v["public-url"],
      });
      output({
        mode: "poa-domains-registry",
        url: s.url,
        publicUrl: v["public-url"] ?? null,
      });
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await s.close();
        e.close();
      };
      process.on("SIGINT", () => void stop());
      process.on("SIGTERM", () => void stop());
    } catch (e2) {
      e.close();
      throw e2;
    }
  } else
    throw new Fault("COMMAND");
 } catch (e) {
  const failure=cliFailure(e);process.stderr.write(JSON.stringify(failure.body)+"\n");process.exitCode=failure.exitCode;
}
