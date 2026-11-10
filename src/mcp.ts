import { errorEnvelope, correlationId } from "./errors.js";
import { exact, Fault } from "./core.js";
import { NativeReader, NativeMonitor } from "./native.js";
import { productionStatus } from "./production.js";
import { runMcpStdio } from "./mcp-stdio.js";
import { objectSchema } from "./mcp-schema.js";
/** The native-only guard profile retains exactly its public-read tools. No registry fallback. */
export async function runMcp(options: unknown = {}): Promise<void> {
  exact(options, []);
  const reader = new NativeReader(),
    monitor = new NativeMonitor(reader);
  const outputSchema = {
    type: "object",
    properties: { mode: { type: "string" } },
    additionalProperties: true,
  };
  await runMcpStdio({
    name: "poa-domains-read-only",
    instructions:
      "Native naming unavailable. No signing, settlement, simulated state or reference fallback. Public native reports do not verify consensus/finality.",
    tools: [
      {
        name: "registry_status",
        description: "Read disabled native-registry availability.",
        inputSchema: objectSchema({}),
        outputSchema,
        annotations: { readOnlyHint: true },
        call: async () => productionStatus(),
      },
      {
        name: "native_network",
        description:
          "Read fixed public native status/provenance; not naming ownership or verified finality.",
        inputSchema: objectSchema({}),
        outputSchema,
        annotations: { readOnlyHint: true },
        call: () => monitor.observe(),
      },
      {
        name: "native_receipt",
        description:
          "Read a reported native transaction receipt, without finality/retry authorization.",
        inputSchema: objectSchema({
          txid: { type: "string", pattern: "^[a-f0-9]{64}$" },
        }),
        outputSchema,
        annotations: { readOnlyHint: true },
        call: (a: any) => reader.receipt(a.txid),
      },
    ],
    unknownTool: async () => {
      const status = productionStatus();
      throw Object.assign(new Fault(status.code), {
        detail: {
          ...status,
          ...errorEnvelope(status.code, correlationId(undefined), {
            message: status.message,
          }),
        },
      });
    },
  });
}
