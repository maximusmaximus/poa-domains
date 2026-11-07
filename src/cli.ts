#!/usr/bin/env node
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { parseArgs } from "node:util";
import { Fault, need, parseJSON } from "./core.js";
import { request, endpoint } from "./client.js";
import { prepare, handoff } from "./interface.js";
import { validateBody, signBody } from "./auth.js";
import { Engine } from "./engine.js";
import { SystemClock } from "./clock.js";
import { attachJournal } from "./store.js";
import { startServer } from "./server.js";
import { runMcp } from "./mcp.js";
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
      name: { type: "string" },
      id: { type: "string" },
      signer: { type: "string" },
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
  if (cmd === "prepare")
    output(prepare(input(), await request(url(), "/v1/capabilities")));
  else if (cmd === "handoff") output(handoff(validateBody(input())));
  else if (cmd === "sign") {
    need(
      v["key-file"]?.length && v["key-file"].length <= 4,
      "KEY_FILE_REQUIRED",
    );
    const body = validateBody(input());
    // Files are read only by the operator's local process. Key bytes never leave it.
    const keys = v["key-file"].map((path) => {
      const st = statSync(path);
      need(
        st.isFile() && st.size <= 8192 && (st.mode & 0o077) === 0,
        "KEY_FILE_PERMISSIONS",
      );
      const key = createPrivateKey(readFileSync(path));
      need(key.asymmetricKeyType === "ed25519", "KEY_SCHEME");
      return key;
    });
    output(signBody(body, keys));
  } else if (cmd === "submit")
    output(await request(url(), "/v1/intents", input()));
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
  } else if (cmd === "mcp") await runMcp(url());
  else if (cmd === "serve") {
    need(v.config && v.data, "CONFIG_AND_DATA_REQUIRED");
    const e = new Engine(
      parseJSON(readFileSync(v.config, "utf8")),
      new SystemClock(),
    );
    attachJournal(e, v.data);
    try {
      const port = Number(v.port ?? "8787");
      need(Number.isInteger(port) && port >= 0 && port <= 65535, "PORT");
      const s = await startServer(e, port);
      output({ mode: "local-reference-only", url: s.url });
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
    throw new Fault(
      "COMMAND: prepare|sign|handoff|submit|capabilities|state|export|resolve|receipt|nonce|mcp|serve",
    );
} catch (e) {
  process.stderr.write(
    JSON.stringify({ code: e instanceof Fault ? e.code : "CLI_ERROR" }) + "\n",
  );
  process.exitCode = 1;
}
