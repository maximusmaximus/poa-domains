// Local-only negative seam: discovery must need neither registry, assets nor network.
import worker from "../worker.js";
export default {
  fetch(request: Request, env: Env) {
    return worker.fetch(request, {
      ...env,
      REGISTRY: {
        getByName() {
          throw Error("Discovery accessed Durable Object");
        },
      },
      ASSETS: {
        fetch() {
          throw Error("Discovery accessed static backend");
        },
      },
    } as unknown as Env);
  },
};
