import { createLiveNetworkReader, LiveNetworkError } from "./live-network.js";
// Local-only spelling analysis, independent of network reads and all registry gates.
const checkerContainer = document.getElementById("emoji-format-checker");
import("./emoji-format-checker.mjs")
  .then(({ mountEmojiFormatChecker }) => mountEmojiFormatChecker(checkerContainer).ready)
  .catch(() => {
    checkerContainer.textContent = "The local emoji spelling checker is unavailable. Native naming and payments remain disabled.";
  });
// Official-node read-only observations. No signer, ledger or simulated fallback.
const liveReader = createLiveNetworkReader();
let refreshFlight;
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
let expiryTimer;
function clearNetwork(message) {
  clearTimeout(expiryTimer);
  document.getElementById("network-status").textContent = message;
  document.getElementById("network-details").textContent = "";
}
function renderNetwork(value) {
  const now = Date.now();
  exact(value, ["kind", "source", "chainId", "observedAt", "expiresAt", "verification", "finalityVerified", "registryReady", "checkpoint", "epochsClosed", "agentsJoined", "transactions", "reportedFinalTransactions", "attestationThreshold", "engineSha256", "paramsSha256"]);
  exact(value.checkpoint, ["height", "cutoffTs"]);
  const counts = [value.observedAt, value.expiresAt, value.checkpoint.height, value.checkpoint.cutoffTs, value.epochsClosed, value.agentsJoined, value.transactions, value.reportedFinalTransactions, value.attestationThreshold];
  if (value.kind !== "native-network-observation" || value.source !== "https://minepoa.com" || value.chainId !== "poa-mainnet-1" || value.verification !== "node-reported-unverified" || value.finalityVerified !== false || value.registryReady !== false || !counts.every(n => Number.isSafeInteger(n) && n >= 0) || value.expiresAt !== value.observedAt + 900000 || value.observedAt > now + 300000 || now > value.expiresAt || value.checkpoint.cutoffTs * 1000 > value.observedAt + 300000 || value.reportedFinalTransactions > value.transactions || value.attestationThreshold < 1 || value.attestationThreshold > 256 || !/^[a-f0-9]{64}$/.test(value.engineSha256) || !/^[a-f0-9]{64}$/.test(value.paramsSha256)) throw Error("Observation unavailable");
  document.getElementById("network-status").textContent = "Official-node observation (unverified), naming still unavailable. Observed " + new Date(value.observedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  document.getElementById("network-details").textContent = "Network: " + value.chainId + "\nReported checkpoint: " + value.checkpoint.height + "\nClosed epochs: " + value.epochsClosed + "\nJoined agents: " + value.agentsJoined + "\nReported transactions: " + value.transactions + "\nReported engine SHA-256: " + value.engineSha256 + "\nReported params SHA-256: " + value.paramsSha256;
  expiryTimer = setTimeout(() => clearNetwork("Network observation expired; no current network state is displayed."), Math.min(value.expiresAt - now + 1, 900001));
}
async function refreshOnce() {
  clearNetwork("Network observation unavailable or expired.");
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
    try { renderNetwork(await liveReader.observe()); }
    catch (failure) {
      const detail = failure instanceof LiveNetworkError
        ? failure.code + ": " + failure.message
        : "Live network observation could not be validated.";
      clearNetwork(detail + " No current network state is displayed.");
    }
  } catch {
    document.getElementById("status").textContent =
      "Fail-closed: native registry unavailable; all operations disabled.";
    error.textContent =
      "Availability document could not be validated. No backend or reference fallback is used.";
  }
}
function refresh() {
  if (refreshFlight) return refreshFlight;
  const button = document.getElementById("refresh");
  button.disabled = true;
  refreshFlight = refreshOnce().finally(() => {
    refreshFlight = undefined;
    button.disabled = false;
    const announcement = document.getElementById("refreshAnnouncement");
    const summary = [document.getElementById("status").textContent,error.textContent,document.getElementById("network-status").textContent].filter(Boolean).join(" ");
    if(announcement.textContent!==summary)announcement.textContent=summary;
  });
  return refreshFlight;
}
document.getElementById("refresh").addEventListener("click", refresh);
await refresh();
