import { createInterface } from "node:readline";
import { exact, Fault, need, parseJSON } from "./core.js";
import { productionStatus } from "./production.js";

export async function runMcp(options: unknown = {}): Promise<void> {
  exact(options, []);
  let initialized = false,
    ready = false;
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let rpc: any;
    try {
      rpc = parseJSON(line, 65536);
      need(rpc.jsonrpc === "2.0", "RPC");
      if (rpc.method === "notifications/initialized") {
        need(initialized, "MCP_NOT_INITIALIZED");
        ready = true;
        continue;
      }
      if (!Object.hasOwn(rpc, "id")) continue;
      let result: any;
      if (rpc.method === "initialize") {
        need(!initialized, "MCP_ALREADY_INITIALIZED");
        initialized = true;
        result = {
          protocolVersion: "2025-11-25",
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "poa-domains-production-guard",
            version: "0.1.0",
          },
          instructions:
            "Native naming unavailable. Only registry_status is supported. No signing, settlement, simulated state or reference fallback.",
        };
      } else if (rpc.method === "ping") result = {};
      else {
        need(ready, "MCP_NOT_INITIALIZED");
        if (rpc.method === "tools/list")
          result = {
            tools: [
              {
                name: "registry_status",
                description:
                  "Read disabled native-registry availability; no network state or ownership claims",
                inputSchema: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                },
                annotations: { readOnlyHint: true },
              },
            ],
          };
        else if (rpc.method === "tools/call") {
          const params = exact(rpc.params, ["name", "arguments"]);
          if (params.name === "registry_status") {
            exact(params.arguments, []);
            result = {
              content: [
                { type: "text", text: JSON.stringify(productionStatus()) },
              ],
              isError: false,
            };
          } else
            result = {
              content: [
                { type: "text", text: JSON.stringify(productionStatus()) },
              ],
              isError: true,
            };
        } else if (rpc.method === "resources/list") result = { resources: [] };
        else if (rpc.method === "prompts/list") result = { prompts: [] };
        else throw new Fault("METHOD_NOT_FOUND");
      }
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }) + "\n",
      );
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc?.id ?? null,
          error: {
            code: -32600,
            message: error instanceof Fault ? error.code : "RPC_ERROR",
          },
        }) + "\n",
      );
    }
  }
}
