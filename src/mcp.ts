import { faultEnvelope, errorEnvelope, correlationId } from './errors.js';
import { createInterface } from "node:readline";
import { exact, Fault, need, parseJSON } from "./core.js";
import { NativeReader, NativeMonitor } from "./native.js";
import { productionStatus } from "./production.js";

export async function runMcp(options: unknown = {}): Promise<void> {
  exact(options, []);
  const reader = new NativeReader(), monitor = new NativeMonitor(reader);
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
            name: "poa-domains-read-only",
            version: "0.1.0",
          },
          instructions:
            "Native naming unavailable. registry_status reports application availability. native_network and native_receipt read fixed public node routes; reports are NOT verified consensus/finality. No signing, settlement, simulated state or reference fallback.",
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
              { name: "native_network", description: "Read official public native node status and provenance; unverified report, never naming ownership or finality", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
              { name: "native_receipt", description: "Read a reported native transaction receipt; unknown never authorizes retry, flags do not verify finality", inputSchema: { type: "object", properties: { txid: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["txid"], additionalProperties: false }, annotations: { readOnlyHint: true } },
            ],
          };
        else if (rpc.method === "tools/call") {
          const params = exact(rpc.params, ["name", "arguments"]);
          if (params.name === "native_network" || params.name === "native_receipt") {
            const args = exact(params.arguments, params.name === "native_receipt" ? ["txid"] : []);
            const value = params.name === "native_network" ? await monitor.observe() : await reader.receipt(args.txid);
            result = { content: [{ type: "text", text: JSON.stringify(value) }], isError: false };
          } else if (params.name === "registry_status") {
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
                { type: "text", text: JSON.stringify({...productionStatus(),...errorEnvelope(productionStatus().code,correlationId(undefined),{message:productionStatus().message})}) },
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
            data:faultEnvelope(error),
          },
        }) + "\n",
      );
    }
  }
}
