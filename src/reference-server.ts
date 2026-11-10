import { correlationId, errorReply } from './errors.js';
import { createServer, Server } from "node:http";
import { readFileSync } from "node:fs";
import { Engine } from "./engine.js";
import { Fault, need } from "./core.js";
import { registryRoute, RegistryRouteOptions } from "./registry-routes.js";
const files: Record<string, [string, string]> = {
  "/icon.svg": ["icon.svg", "image/svg+xml"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/escrow.js": ["escrow.js", "text/javascript; charset=utf-8"],
  "/agent-cart-v2.schema.json": ["agent-cart-v2.schema.json", "application/schema+json; charset=utf-8"],
  "/shared.js": ["shared.js", "text/javascript; charset=utf-8"],
  "/config.json": ["config.json", "application/json; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/XeroEmoji-COLRv1.woff2": ["XeroEmoji-COLRv1.woff2", "font/woff2"],
};
// Explicit module allowlist, never arbitrary filesystem paths.
for (const name of ["agent-cart.js", "ui-cart.js", "ui-core.js", "ui-domain.js", "ui-handoff.js", "ui-ideas.js", "ui-poll.js", "ui-render.js", "ui-router.js", "ui-search.js", "ui-state.js"]) files["/"+name] = [name, "text/javascript; charset=utf-8"];
export interface ReferenceServerOptions {
  host?: string;
  publicUrl?: string;
  allowedHosts?: string[];
  routes?: RegistryRouteOptions;
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
    const requestId=correlationId(req.headers["x-request-id"]);
    const send = (status: number, data: any) => {
      if(status>=400){const reply=errorReply(status,data,requestId);status=reply.status;data=reply.body;}
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
        const assetPath = /^\/(d|p)\/[^/]+\/?$/.test(u.pathname) ? "/" : u.pathname;
        if (files[assetPath]) {
          const [path, type] = files[assetPath]!;
          res.setHeader("content-type", type);
          return void res.end(
            readFileSync(
              new URL("../../reference-web/" + path, import.meta.url),
            ),
          );
        }
        const reply = registryRoute(engine, {method:"GET",path:u.pathname,query:Object.fromEntries(u.searchParams),requestId},options.routes);
        return send(reply.status,JSON.parse(reply.jsonText));
      }
      if (req.method === "POST" && (u.pathname === "/v1/intents" || u.pathname === "/v1/intents/preview")) {
        need(u.search === "", "QUERY_NOT_ALLOWED");
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
        need(bytes > 0, "EMPTY_BODY");
        const body = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks),
        );
        const reply = registryRoute(engine,{method:"POST",path:u.pathname,query:{},packet:body,requestId},options.routes);
        return send(reply.status,JSON.parse(reply.jsonText));
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
