// Availability display only. No signer, ledger, simulated fallback or API client.
const error = document.getElementById("error");
async function read(path) {
  const response = await fetch(new URL(path, location.href), {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw Error("Availability read failed");
  return response.json();
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw Error("Unavailable");
}
async function refresh() {
  error.textContent = "";
  try {
    const config = await read("./config.json");
    exact(config, ["mode", "publicApiBase", "statusFile"]);
    if (
      config.mode !== "production-only" ||
      config.publicApiBase !== null ||
      config.statusFile !== "./status.json"
    )
      throw Error("Unavailable");
    const value = await read("./status.json");
    exact(value, [
      "mode",
      "operational",
      "nativeNamingVerified",
      "backend",
      "code",
      "reason",
      "message",
      "actions",
      "accepted",
      "submitted",
    ]);
    if (
      value.mode !== "production-only" ||
      value.operational !== false ||
      value.nativeNamingVerified !== false ||
      value.backend !== null ||
      value.code !== "NATIVE_NAMING_UNAVAILABLE" ||
      value.reason !== "NO_VERIFIED_NATIVE_NAMING_IMPLEMENTATION" ||
      !Array.isArray(value.actions) ||
      value.actions.length ||
      value.accepted !== false ||
      value.submitted !== false
    )
      throw Error("Unavailable");
    document.getElementById("status").textContent =
      "Verified application guard: native registry unavailable; all operations disabled.";
  } catch {
    document.getElementById("status").textContent =
      "Fail-closed: native registry unavailable; all operations disabled.";
    error.textContent =
      "Availability document could not be validated. No backend or reference fallback is used.";
  }
}
document.getElementById("refresh").addEventListener("click", refresh);
await refresh();
