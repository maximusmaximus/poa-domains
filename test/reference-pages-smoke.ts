import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { verifyReferenceStaticPage } from "./reference-pages-browser.js";
import { buildReferenceBundle } from "./reference-pages-build.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = buildReferenceBundle(
    mkdtempSync(join(tmpdir(), "poa-reference-pages-test-")),
  ),
  prefix = "/poa-domains/";
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const server = createServer((req, res) => {
  if (req.method !== "GET" || !req.url?.startsWith(prefix)) {
    res.writeHead(404);
    return res.end();
  }
  let path: string;
  try {
    path = resolve(
      directory,
      decodeURIComponent(
        new URL(req.url, "http://127.0.0.1").pathname.slice(prefix.length),
      ) || "index.html",
    );
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (
    !path.startsWith(directory + sep) ||
    !existsSync(path) ||
    !statSync(path).isFile()
  ) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader("content-type", types[extname(path)] ?? "text/plain");
  res.setHeader("cache-control", "no-store");
  res.end(readFileSync(path));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  if (!address || typeof address === "string") throw Error("LISTEN");
  const url = "http://127.0.0.1:" + address.port + prefix;
  const result = await verifyReferenceStaticPage(url, process.argv[2]);
  console.log(
    JSON.stringify(
      {
        ...result,
        mode: "static-synthetic-demo",
        repoSubpath: prefix,
        serverClosed: true,
        testOnly: true,
      },
      null,
      2,
    ),
  );
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((e) => (e ? reject(e) : resolve()));
    server.closeIdleConnections();
  });
  rmSync(directory, { recursive: true, force: true });
}
