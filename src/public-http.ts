import { spawn } from "node:child_process";
import { Fault, need } from "./core.js";
// Standard public HTTPS transport, not a browser/internal API/session adapter.
// curl --disable MUST be first: no ~/.curlrc, cookies, auth, proxy config, netrc,
// inherited credentials or shell expansion. This dependency is explicit in docs.
export function publicHttps(url: string, init: RequestInit): Promise<Response> {
  need(/^https:\/\/minepoa\.com\/chain\/poa-mainnet-1\/api\/(?:status|network-facts|receipt\/[a-f0-9]{64})$/.test(url), "NATIVE_ROUTE");
  need(init.method === "GET" && init.credentials === "omit" && init.redirect === "error" && init.body === undefined, "NATIVE_TRANSPORT");
  return new Promise((resolve, reject) => {
    const win32 = process.platform === "win32";
    const child = spawn(win32 ? "C:\\Windows\\System32\\curl.exe" : "curl", ["--disable", "--silent", "--show-error", "--proto", "=https", "--max-time", "10", "--max-filesize", "65536", "--include", "--header", "Accept: application/json", "--url", url], {
      env: win32 ? { PATH: "C:\\Windows\\System32", SystemRoot: "C:\\Windows", LANG: "C.UTF-8" } : { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0, failed = false;
    const stop = () => { failed = true; child.kill("SIGKILL"); };
    init.signal?.addEventListener("abort", stop, { once: true });
    if (init.signal?.aborted) stop();
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > 81920) stop();
      else chunks.push(Buffer.from(chunk));
    });
    // stderr can contain arbitrary server/certificate text: discard, never log.
    child.stderr.resume();
    child.once("error", () => { failed = true; });
    child.once("close", code => {
      init.signal?.removeEventListener("abort", stop);
      try {
        need(!failed && code === 0, "NATIVE_READ_FAILED");
        let body = Buffer.concat(chunks), status = 0;
        const headers = new Headers();
        // Handle informational HTTP headers, never follow a redirect.
        while (true) {
          const end = body.indexOf("\r\n\r\n");
          need(end >= 0 && end <= 16384, "NATIVE_HTTP_HEADERS");
          const lines = body.subarray(0, end).toString("utf8").split("\r\n");
          const match = /^HTTP\/[12](?:\.[01])? ([1-5][0-9]{2})(?: |$)/.exec(lines.shift() ?? "");
          need(match, "NATIVE_HTTP_HEADERS"); status = Number(match[1]);
          body = body.subarray(end + 4);
          if (status < 200) continue;
          for (const line of lines) {
            const colon = line.indexOf(":"); need(colon > 0, "NATIVE_HTTP_HEADERS");
            const name = line.slice(0, colon).toLowerCase();
            if (["content-type", "content-length", "age"].includes(name)) {
              need(!headers.has(name), "NATIVE_HTTP_HEADERS");
              headers.set(name, line.slice(colon + 1).trim());
            }
          }
          break;
        }
        need(body.length <= 65536, "BODY_TOO_LARGE");
        resolve(new Response([204, 205, 304].includes(status) ? null : body, { status, headers }));
      } catch (error) { reject(error instanceof Fault ? error : new Fault("NATIVE_READ_FAILED")); }
    });
  });
}
