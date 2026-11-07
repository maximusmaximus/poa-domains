import { generateKeyPairSync } from "node:crypto";
import { publicPrincipal } from "./auth.js";
import { fixtureConfig } from "./config.js";
import { Engine } from "./engine.js";
import { SystemClock } from "./clock.js";
import { startServer } from "./server.js";
// Synthetic local identities only. The private keys are discarded and never exported.
const people = Array.from({ length: 3 }, () =>
  publicPrincipal(generateKeyPairSync("ed25519").privateKey),
);
const engine = new Engine(
  fixtureConfig(people[0]!, people[0]!, people.slice(1)),
  new SystemClock(),
);
const server = await startServer(engine, 8787);
console.log(
  JSON.stringify({
    mode: "read-only in-memory local fixture; no chain accounts",
    url: server.url,
  }),
);
const stop = async () => {
  await server.close();
  engine.close();
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
