// Local-only fault seam. Production ingress/core and real Engine; no upstream I/O.
import worker from "../worker.js";
import { registryRoute, type RegistryCall } from "../../src/registry-routes.js";
import {
  contractEngine,
  CONTRACT_OPTIONS,
} from "../../test/fixtures/contract-engine.js";
let engine: ReturnType<typeof contractEngine>;
export default {
  fetch(request: Request, env: Env & { CONTRACT_CONFIG: string }) {
    engine ??= contractEngine(JSON.parse(env.CONTRACT_CONFIG));
    const fault = request.headers.get("x-test-fault");
    const registry = {
      handle(call: RegistryCall) {
        const reply = registryRoute(engine, call, CONTRACT_OPTIONS);
        if (fault === "malformed-reply") return { status: 200, jsonText: "{" };
        if (fault === "wrong-receipt")
          return {
            status: 200,
            jsonText: JSON.stringify({
              intentId: "0".repeat(64),
              requestId: "wrong",
              status: "succeeded",
              accepted: true,
            }),
          };
        if (fault === "after-dispatch")
          throw Error("fixture lost RPC response");
        return reply;
      },
    };
    const limiter =
      fault === "rate-missing"
        ? undefined
        : fault === "rate-deny"
          ? { limit: async () => ({ success: false }) }
          : fault === "rate-error"
            ? {
                limit: async () => {
                  throw Error("fixture rate service unavailable");
                },
              }
            : env.MCP_RATE_LIMITER;
    return worker.fetch(request, {
      ...env,
      MCP_RATE_LIMITER: limiter,
      REGISTRY: { getByName: () => registry },
    } as unknown as Env);
  },
};
