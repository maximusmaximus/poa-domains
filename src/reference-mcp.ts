import { request } from "./client.js";
import { registryMcpProfile } from "./mcp-registry.js";
import { runMcpStdio } from "./mcp-stdio.js";
export async function runReferenceMcp(url: string): Promise<void> {
  await runMcpStdio(
    registryMcpProfile((method, path, query = {}, packet) =>
      request(
        url,
        path +
          (Object.keys(query).length ? "?" + new URLSearchParams(query) : ""),
        method === "POST" ? packet : undefined,
      ),
    ),
  );
}
