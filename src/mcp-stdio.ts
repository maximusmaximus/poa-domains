import { McpCore, McpProfile, rpcError } from "./mcp-core.js";
/** Bounded newline frames; no unbounded readline allocation for a hostile input line. */
export async function runMcpStdio(profile: McpProfile): Promise<void> {
  const core = new McpCore(profile);
  let pending = Buffer.alloc(0),
    oversize = false;
  const emit = async () => {
    let reply;
    try {
      reply = await core.handle(
        oversize
          ? " ".repeat(65537)
          : new TextDecoder("utf-8", { fatal: true }).decode(pending),
      );
    } catch {
      reply = rpcError(-32700, "MCP_PARSE_ERROR");
    }
    if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    pending = Buffer.alloc(0);
    oversize = false;
  };
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (let i = 0; i <= bytes.length; i++)
      if (i === bytes.length || bytes[i] === 10) {
        const part = bytes.subarray(start, i);
        if (pending.length + part.length > 65536) oversize = true;
        if (!oversize) pending = Buffer.concat([pending, part]);
        if (i < bytes.length) await emit();
        start = i + 1;
      }
  }
  if (pending.length || oversize) await emit();
}
