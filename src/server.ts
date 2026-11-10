import { correlationId, errorReply } from './errors.js';
import { createServer, Server } from "node:http";
import { Fault, need } from "./core.js";
import { NativeReader, NativeMonitor, nativeFailure } from "./native.js";
import { productionOptions, productionStatus } from "./production.js";

// Read-only localhost API. No Engine, ledger, signer, configuration file or
// caller-selected provider connection is accepted. Reference service lives in reference-server.
export async function startServer(options: unknown = {}): Promise<{
  server: Server;
  url: string;
  close: () => Promise<void>;
}> {
  const { port } = productionOptions(options);
  const reader = new NativeReader(), monitor = new NativeMonitor(reader);
  let cached: { at: number; value: unknown } | undefined;
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("connection", "close");
    const send = (status: number, data: unknown) => {
      // Preserve the fail-closed availability document, not an operational registry error.
      if(status>=400&&(data as any)?.mode!=="production-only"){const reply=errorReply(status,data,correlationId(req.headers["x-request-id"]));status=reply.status;data=reply.body;}
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    try {
      need((req.url?.length ?? 0) <= 4096, "URL_SIZE");
      need(/^127\.0\.0\.1(?::[0-9]+)?$/.test(req.headers.host ?? ""), "HOST");
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && !u.search) {
        if (u.pathname === "/v1/native/network") {
          try {
            if (!cached || Date.now() - cached.at > 10000) cached = { at: Date.now(), value: await monitor.observe() };
            return send(200, cached.value);
          } catch (error) { cached = undefined; return send(502, nativeFailure(error)); }
        }
        if (u.pathname.startsWith("/v1/native/receipts/")) {
          try { return send(200, await reader.receipt(u.pathname.slice("/v1/native/receipts/".length))); }
          catch (error) { return send(error instanceof Fault && error.code === "NATIVE_DIGEST" ? 400 : 502, nativeFailure(error)); }
        }
        if (u.pathname === "/healthz")
          return send(200, { processAlive: true, registryReady: false });
        if (["/v1/status", "/v1/capabilities"].includes(u.pathname))
          return send(200, productionStatus());
        if (u.pathname === "/readyz") return send(503, productionStatus());
      }
      if (u.pathname.startsWith("/v1/")) return send(503, productionStatus());
      return send(404, {
        code: "NOT_FOUND",
        accepted: false,
        submitted: false,
      });
    } catch (error) {
      return send(400, {
        code: error instanceof Fault ? error.code : "INVALID_REQUEST",
        accepted: false,
        submitted: false,
      });
    } finally {
      // Reject without parsing/storing request bodies or waiting for uploads.
      res.once("finish", () => {
        if (!req.complete) req.destroy();
      });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxConnections = 32;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  need(address && typeof address === "object");
  let closing: Promise<void> | undefined;
  return {
    server,
    url: "http://127.0.0.1:" + address.port,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      })),
  };
}
