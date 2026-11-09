import { createServer, Server } from "node:http";
import { readFileSync } from "node:fs";
import { Engine } from "./engine.js";
import { capabilities } from "./interface.js";
import { Fault, need, parseJSON, text } from "./core.js";
import { normalizeName } from "./names.js";
const files: Record<string, [string, string]> = {
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/escrow.js": ["escrow.js", "text/javascript; charset=utf-8"],
  "/shared.js": ["shared.js", "text/javascript; charset=utf-8"],
  "/config.json": ["config.json", "application/json; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/XeroEmoji-COLRv1.woff2": ["XeroEmoji-COLRv1.woff2", "font/woff2"],
};
export interface ReferenceServerOptions {
  host?: string;
  publicUrl?: string;
  allowedHosts?: string[];
}
export async function startReferenceServer(
  engine: Engine,
  port = 0,
  options: ReferenceServerOptions = {},
): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const bindHost = options.host ?? "127.0.0.1";
  const allowedHostnames = new Set<string>([
    "127.0.0.1",
    "localhost",
    "poadomains.grok.me",
    ...(options.allowedHosts ?? []),
  ]);
  if (options.publicUrl) {
    try {
      allowedHostnames.add(new URL(options.publicUrl).hostname.toLowerCase());
    } catch {
      /* ignore invalid publicUrl override */
    }
  }
  const server = createServer(async (req, res) => {
    const send = (status: number, data: any) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
    };
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    try {
      need((req.url?.length ?? 0) <= 4096, "URL_SIZE");
      const rawHost = (req.headers.host ?? "").toLowerCase();
      const hostMatch = /^([a-z0-9.-]+)(?::[0-9]+)?$/.exec(rawHost);
      const hostname = hostMatch?.[1] ?? "";
      need(
        Boolean(
          hostname &&
          (allowedHostnames.has(hostname) ||
            hostname === "grok.me" ||
            hostname.endsWith(".grok.me")),
        ),
        "HOST",
      );
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET") {
        res.setHeader("access-control-allow-origin", "*");
        if (u.pathname === "/healthz")
          return send(200, {
            status: "ok",
            processAlive: true,
            chainId: engine.config.chainId,
            revision: engine.config.revision,
            sequence: engine.snapshot().sequence,
            durability: engine.durability(),
          });
        if (files[u.pathname]) {
          const [path, type] = files[u.pathname]!;
          res.setHeader("content-type", type);
          return void res.end(
            readFileSync(
              new URL("../../reference-web/" + path, import.meta.url),
            ),
          );
        }
        if (u.pathname === "/v1/capabilities")
          return send(200, capabilities(engine));
        if (u.pathname === "/v1/state")
          return send(200, {
            state: engine.snapshot(),
            stateHash: engine.stateHash(),
            observedServerTime: engine.observedTime(),
            durability: engine.durability(),
            finality: "registry-committed",
          });
        if (u.pathname === "/v1/resolve")
          return send(
            200,
            engine.resolve(
              normalizeName(
                u.searchParams.get("name"),
                engine.normalizationMode,
              ).canonical,
            ),
          );
        if (u.pathname === "/v1/nonce")
          return send(200, {
            nonce: engine.nextNonce(u.searchParams.get("signer") ?? ""),
          });
        if (u.pathname.startsWith("/v1/receipts/")) {
          const id = u.pathname.slice("/v1/receipts/".length);
          need(/^[0-9a-f]{64}$/.test(id), "INTENT_ID");
          const receipt = engine.receipt(id);
          return send(
            receipt ? 200 : 404,
            receipt ?? { status: "unknown", code: "UNKNOWN_OUTCOME" },
          );
        }
        return send(404, { code: "NOT_FOUND" });
      }
      if (req.method === "POST" && u.pathname === "/v1/intents") {
        need(
          !req.headers.origin && !req.headers["sec-fetch-site"],
          "BROWSER_WRITES_DISABLED",
        );
        need(
          req.headers["content-type"] === "application/json",
          "CONTENT_TYPE",
        );
        need(!req.headers["content-encoding"], "ENCODING");
        const length = req.headers["content-length"];
        if (length)
          need(
            /^[0-9]+$/.test(length) && Number(length) <= 65536,
            "BODY_TOO_LARGE",
          );
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          need(bytes <= 65536, "BODY_TOO_LARGE");
          chunks.push(chunk);
        }
        const body = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks),
        );
        const packet = parseJSON(body);
        const receipt = engine.submit(packet);
        return send(200, {
          ...receipt,
          accepted: true,
          durability: engine.durability(),
          finality: "registry-committed",
        });
      }
      return send(405, { code: "METHOD_NOT_ALLOWED" });
    } catch (e) {
      const code = e instanceof Fault ? e.code : "INVALID_REQUEST";
      if (!res.headersSent)
        send(
          code === "BODY_TOO_LARGE"
            ? 413
            : code === "DURABILITY_UNKNOWN_RESTART_AND_QUERY"
              ? 503
              : 400,
          {
            code,
            accepted:
              code === "DURABILITY_UNKNOWN_RESTART_AND_QUERY"
                ? "unknown"
                : false,
          },
        );
      else res.end();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  need(address && typeof address === "object");
  const urlHost =
    bindHost === "0.0.0.0" || bindHost === "::" ? "127.0.0.1" : bindHost;
  const url = "http://" + urlHost + ":" + address.port;
  let closing: Promise<void> | undefined;
  return {
    server,
    url,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections();
      })),
  };
}
