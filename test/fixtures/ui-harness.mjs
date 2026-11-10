// GET-only loopback browser fixture. No upstream, credentials, signatures or real PoA actions.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { Engine } from "../../dist/src/engine.js";
import { fixtureConfig, mainnetConfig } from "../../dist/src/config.js";
import { ManualClock } from "../../dist/src/clock.js";
import { capabilities } from "../../dist/src/interface.js";
export const SIGNER = "ed25519:" + "1".repeat(64);
export function profileEngine(profile = "fixture") {
  const issuer = profile === "mainnet" ? "poa1" + "1".repeat(32) : "ed25519:" + "2".repeat(64);
  const treasury = profile === "mainnet" ? "poa1" + "1".repeat(31) + "2" : "ed25519:" + "3".repeat(64);
  const buyer = profile === "mainnet" ? "poa1" + "1".repeat(31) + "3" : SIGNER;
  const config = (profile === "mainnet" ? mainnetConfig : fixtureConfig)(issuer, treasury, [buyer]);
  return new Engine(config, new ManualClock(1000000));
}
export async function uiHarness(profile = "fixture", options = {}) {
  const engine = profileEngine(profile);
  const h = { cap: capabilities(engine), payload: { state: engine.snapshot(), finality: "registry-committed" },
    stateStatus: 200, stateDelay: 0, stateReads: 0, writes: [], telemetry: [] };
  const root = resolve("reference-web");
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    // Only the dedicated telemetry fixture accepts this non-financial local POST.
    // All existing GET-only suites explicitly receive local config and keep rejecting every write.
    if(options.logSearches && u.pathname === "/v1/search-log" && req.method === "POST") {
      let body="";for await(const part of req){body+=part;if(body.length>1024){res.writeHead(413);return res.end();}}
      h.telemetry.push(JSON.parse(body));res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify(h.telemetryReply??{saved:true,key:'v1/2026-11-10/00000000-0000-0000-0000-000000000001.jsonl'}));
    }
    if (req.method !== "GET" && req.method !== "HEAD") { h.writes.push(req.method); res.writeHead(405); return res.end(); }
    const json = (body, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (u.pathname === "/config.json") return json({mode:options.logSearches?"live-registry":"local-reference-only",publicApiBase:""});
    if (u.pathname === "/v1/capabilities") return json(h.cap);
    if (u.pathname === "/v1/state") {
      h.stateReads++;
      if (h.stateDelay) await new Promise(r => setTimeout(r, h.stateDelay));
      return json(h.stateStatus === 200 ? h.payload : { code: "UNAVAILABLE" }, h.stateStatus);
    }
    if (u.pathname === "/v1/network-status") return json(h.networkStatus??{ level: "online", hold: false, message: "🟢 Local test network", livePoA: false });
    if (u.pathname === "/v1/escrow/capabilities") return json({ enabled: false });
    if (u.pathname.startsWith("/v1/")) return json({ code: "NOT_FOUND" }, 404);
    const pathname = u.pathname === "/" || /^\/(d|p)\/[^/]+$/.test(u.pathname) ? "/index.html" : u.pathname;
    const file = resolve(root, "." + pathname);
    if (!file.startsWith(root + sep)) { res.writeHead(404); return res.end(); }
    try {
      const mime = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
      const bytes = readFileSync(file);
      res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(bytes);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  h.url = `http://127.0.0.1:${server.address().port}`;
  h.close = () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); });
  return h;
}
