#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, generateKeyPairSync, KeyObject } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Fault, need, parseJSON } from "./core.js";
import { nativePrincipal } from "./auth.js";
import { Config, mainnetConfig } from "./config.js";
import { BootableSystemClock, seedRegistry } from "./seed.js";
import { Engine } from "./engine.js";
import { EMOJI17_RECORD_COUNT } from "./names.js";
import { startReferenceServer } from "./reference-server.js";
import { attachJournal } from "./store.js";

export interface RegistryAppOptions {
  dataDir?: string;
  port?: number;
  host?: string;
  publicUrl?: string;
  seed?: boolean;
}

export interface RegistryAppInstance {
  url: string;
  publicUrl: string;
  port: number;
  dataDir: string;
  config: Config;
  principals: Record<string, string>;
  keysDir: string;
  engine: Engine;
  close: () => Promise<void>;
}

const ROLES = ["issuer", "treasury", "alice", "bob", "carol"] as const;

export async function startRegistryApp(
  options: RegistryAppOptions = {},
): Promise<RegistryAppInstance> {
  const dataDir = resolve(options.dataDir ?? "local-data/registry");
  const keysDir = join(dataDir, "keys");
  const journalDir = join(dataDir, "journal");
  mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  mkdirSync(journalDir, { recursive: true, mode: 0o700 });

  const configPath = join(dataDir, "config.json");
  const principalsPath = join(dataDir, "principals.json");

  const keys: Record<string, KeyObject> = {};
  let principals: Record<string, string> = {};
  let config: Config;

  if (!existsSync(configPath)) {
    for (const role of ROLES) {
      const { privateKey } = generateKeyPairSync("ed25519");
      keys[role] = privateKey;
      principals[role] = nativePrincipal(privateKey);
      writeFileSync(
        join(keysDir, `${role}.pem`),
        privateKey.export({ format: "pem", type: "pkcs8" }),
        { mode: 0o600 },
      );
    }
    config = mainnetConfig(principals.issuer!, principals.treasury!, [
      principals.alice!,
      principals.bob!,
      principals.carol!,
    ]);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    writeFileSync(principalsPath, JSON.stringify(principals, null, 2) + "\n", {
      mode: 0o600,
    });
  } else {
    config = parseJSON(readFileSync(configPath, "utf8"), 262144, 4096);
    principals = existsSync(principalsPath)
      ? { ...parseJSON(readFileSync(principalsPath, "utf8")) }
      : { issuer: config.issuer, treasury: config.treasury };
    for (const role of ROLES) {
      const pemPath = join(keysDir, `${role}.pem`);
      if (existsSync(pemPath)) {
        keys[role] = createPrivateKey(readFileSync(pemPath));
      }
    }
  }

  const clock = new BootableSystemClock();
  const engine = new Engine(config, clock);
  attachJournal(engine, journalDir);

  seedRegistry(engine, clock, principals, keys, options.seed !== false);

  try {
    const port = options.port ?? 8787;
    need(Number.isInteger(port) && port >= 0 && port <= 65535, "PORT");
    const server = await startReferenceServer(engine, port, {
      host: options.host,
      publicUrl: options.publicUrl,
    });
    const parsedUrl = new URL(server.url);
    const publicUrl = options.publicUrl ?? "https://poadomains.grok.me";
    let closed = false;
    return {
      url: server.url,
      publicUrl,
      port: Number(parsedUrl.port),
      dataDir,
      config,
      principals,
      keysDir,
      engine,
      close: async () => {
        if (closed) return;
        closed = true;
        await server.close();
        engine.close();
      },
    };
  } catch (err) {
    engine.close();
    throw err;
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    const { values: v } = parseArgs({
      allowPositionals: false,
      options: {
        data: { type: "string" },
        port: { type: "string" },
        host: { type: "string" },
        "public-url": { type: "string" },
        "no-seed": { type: "boolean" },
      },
    });
    const port =
      v.port !== undefined
        ? Number(v.port)
        : process.env.POA_DOMAINS_PORT
          ? Number(process.env.POA_DOMAINS_PORT)
          : process.env.PORT
            ? Number(process.env.PORT)
            : 8787;
    need(Number.isInteger(port) && port >= 0 && port <= 65535, "PORT");
    const app = await startRegistryApp({
      dataDir: v.data ?? process.env.POA_DOMAINS_DATA,
      port,
      host:
        v.host ??
        process.env.POA_DOMAINS_HOST ??
        process.env.HOST ??
        (process.env.PORT ? "0.0.0.0" : undefined),
      publicUrl: v["public-url"] ?? process.env.POA_DOMAINS_PUBLIC_URL,
      seed: !v["no-seed"],
    });
    const snap = app.engine.snapshot();
    process.stdout.write(
      JSON.stringify(
        {
          status: "running",
          url: app.url,
          publicUrl: app.publicUrl,
          chainId: app.config.chainId,
          revision: app.config.revision,
          signingMode: app.config.signingMode,
          durability: app.engine.durability(),
          emojiSequencesSupported: EMOJI17_RECORD_COUNT,
          reservedNamesCount: app.config.reserved.length,
          sequence: snap.sequence,
          ownedNames: Object.values(snap.names)
            .filter((n) => n.activeId)
            .map((n) => n.name),
          liveAuctions: Object.values(snap.auctions)
            .filter((a) => a.status === "live")
            .map((a) => a.name),
          principals: app.principals,
          dataDir: app.dataDir,
          keysDir: app.keysDir,
          cliUsage: {
            keygen: `node dist/src/reference-cli.js keygen --out agent.pem`,
            resolve: `node dist/src/reference-cli.js resolve --url ${app.url} --name nexus`,
            state: `node dist/src/reference-cli.js state --url ${app.url}`,
            capabilities: `node dist/src/reference-cli.js capabilities --url ${app.url}`,
          },
        },
        null,
        2,
      ) + "\n",
    );
    const stop = async () => {
      await app.close();
    };
    process.on("SIGINT", () => void stop());
    process.on("SIGTERM", () => void stop());
  } catch (e) {
    process.stderr.write(
      JSON.stringify({ code: e instanceof Fault ? e.code : "APP_ERROR" }) +
        "\n",
    );
    process.exitCode = 1;
  }
}
