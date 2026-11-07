import { createServer, Server } from "node:http";
import { Fault, need } from "./core.js";
import { productionOptions, productionStatus } from "./production.js";

// Status-only localhost API. No Engine, ledger, signer, configuration file or
// provider connection is accepted. Reference service lives in reference-server.
export async function startServer(options: unknown = {}): Promise<{
  server: Server;
  url: string;
  close: () => Promise<void>;
}> {
  const { port } = productionOptions(options);
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("connection", "close");
    const send = (status: number, data: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    try {
      need((req.url?.length ?? 0) <= 4096, "URL_SIZE");
      need(/^127\.0\.0\.1(?::[0-9]+)?$/.test(req.headers.host ?? ""), "HOST");
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && !u.search) {
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
