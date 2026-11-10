import { faultEnvelope } from './errors.js';
import { createInterface } from "node:readline";
import { need, parseJSON, Fault, exact, text } from "./core.js";
import { request } from "./client.js";
import { buildMetadataWitness } from "./interface.js";
export async function runReferenceMcp(url: string): Promise<void> {
  let initialized = false,
    ready = false;
  const tools = [
    {
      name: "read_state",
      description: "Read local committed reference state, not chain finality",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "submit_intent",
      description:
        "Submit exactly one fully signed local intent. No keys. All implemented actions are enumerated in capabilities.",
      inputSchema: {
        type: "object",
        properties: {
          body: { type: "object" },
          signatures: { type: "object" },
        },
        required: ["body", "signatures"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      },
    },
  ];
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
          serverInfo: { name: "poa-domains-local-reference", version: "0.1.0" },
          instructions:
            "Only local reference state. No live PoA access. Never supply keys. Use a previously authorized exact signed packet; query receipt after uncertainty.",
        };
      } else if (rpc.method === "ping") result = {};
      else {
        need(ready, "MCP_NOT_INITIALIZED");
        if (rpc.method === "tools/list")
          result = {
            tools: [
              ...tools,
              {
                name: "read_capabilities",
                description:
                  "Read all implemented action payload schemas and pinned policies",
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
          const p = exact(rpc.params, ["name", "arguments"]);
          let data: any;
          try {
            if (p.name === "read_state") {
              exact(p.arguments, []);
              data = await request(url, "/v1/state");
            } else if (p.name === "read_capabilities") {
              exact(p.arguments, []);
              data = await request(url, "/v1/capabilities");
            } else if (p.name === "resolve_domain") {
              const args = exact(p.arguments, ["name"]);
              data = await request(
                url,
                "/v1/resolve?name=" + encodeURIComponent(text(args.name, 256)),
              );
            } else if (p.name === "build_metadata_witness") {
              const args = exact(
                p.arguments,
                ["name"],
                ["parentId", "description"],
              );
              data = buildMetadataWitness(
                text(args.name, 256),
                { kind: "permanent" },
                args.parentId ? text(args.parentId, 128) : null,
                args.description
                  ? text(args.description, 512)
                  : `PoA Domains metadata for ${args.name}`,
              );
            } else {
              need(p.name === "submit_intent", "TOOL");
              data = await request(url, "/v1/intents", p.arguments);
            }
            result = {
              content: [{ type: "text", text: JSON.stringify(data) }],
              isError: data.status === "rejected",
            };
          } catch (e) {
            result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(faultEnvelope(e)),
                },
              ],
              isError: true,
            };
          }
        } else if (
          rpc.method === "resources/list" ||
          rpc.method === "prompts/list"
        )
          result =
            rpc.method === "resources/list"
              ? { resources: [] }
              : { prompts: [] };
        else throw new Fault("METHOD_NOT_FOUND");
      }
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc?.id ?? null,
          error: {
            code: -32600,
            message: e instanceof Fault ? e.code : "RPC_ERROR",
            data:faultEnvelope(e),
          },
        }) + "\n",
      );
    }
  }
}
