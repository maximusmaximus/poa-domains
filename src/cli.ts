#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Fault } from "./core.js";
import { productionStatus, rejectRegistryOperation } from "./production.js";
import { startServer } from "./server.js";
import { runMcp } from "./mcp.js";

// Production entry point. No reference imports, environment-based mode switch,
// endpoint discovery, file reads, signer initialization or simulation fallback.
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: "string" },
      file: { type: "string" },
      out: { type: "string" },
      "key-file": { type: "string", multiple: true },
      config: { type: "string" },
      data: { type: "string" },
      port: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      signer: { type: "string" },
    },
  });
  if (positionals.length !== 1) throw new Fault("COMMAND");
  if (values.config !== undefined || values.data !== undefined)
    throw new Fault("PRODUCTION_CONFIG_UNSUPPORTED");
  if (Object.keys(values).some((key) => key !== "port"))
    rejectRegistryOperation();
  const command = positionals[0];
  if (command === "serve") {
    const port = values.port === undefined ? 8787 : Number(values.port);
    const server = await startServer({ port });
    process.stdout.write(
      JSON.stringify({ ...productionStatus(), url: server.url }) + "\n",
    );
    process.on("SIGINT", () => void server.close());
    process.on("SIGTERM", () => void server.close());
  } else {
    if (values.port !== undefined) throw new Fault("PORT_ONLY_FOR_SERVE");
    if (command === "status" || command === "capabilities")
      process.stdout.write(JSON.stringify(productionStatus()) + "\n");
    else if (command === "ready") {
      process.stdout.write(JSON.stringify(productionStatus()) + "\n");
      process.exitCode = 1;
    } else if (command === "mcp") await runMcp();
    else rejectRegistryOperation();
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error instanceof Fault ? error.code : "CLI_ERROR",
      accepted: false,
      submitted: false,
    }) + "\n",
  );
  process.exitCode = 1;
}
