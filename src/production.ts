import { Fault, exact } from "./core.js";

// This is an availability guard, not a network capability probe or a registry.
// There is deliberately no flag, endpoint, key or fixture that enables settlement.
export const UNAVAILABLE = "NATIVE_NAMING_UNAVAILABLE";
export function productionStatus() {
  return {
    mode: "production-only",
    operational: false,
    nativeNamingVerified: false,
    backend: null,
    code: UNAVAILABLE,
    reason: "NO_VERIFIED_NATIVE_NAMING_IMPLEMENTATION",
    message:
      "Native naming is not implemented or verified by this application. All registry operations are disabled.",
    actions: [],
    accepted: false,
    submitted: false,
  } as const;
}
export function rejectRegistryOperation(): never {
  throw new Fault(UNAVAILABLE);
}
export function productionOptions(value: unknown = {}) {
  const options = exact(value, [], ["port"]);
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Fault("PORT");
  return { port: port as number };
}
