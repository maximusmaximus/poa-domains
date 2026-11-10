import { createLiveNetworkReader, LiveNetworkError } from "./live-network.js";
// Local-only spelling analysis, independent of network reads and all registry gates.
const checkerContainer = document.getElementById("emoji-format-checker");
import("./emoji-format-checker.mjs")
  .then(({ mountEmojiFormatChecker }) => mountEmojiFormatChecker(checkerContainer).ready)
  .catch(() => {
    checkerContainer.textContent = "The local spelling checker is unavailable. This page does not sign or send payments.";
  });
// Official-node read-only observations. No signer, ledger or simulated fallback.
let liveReader = createLiveNetworkReader();
// Only this read-only display gets a new reader, after an explicit user refresh
// acknowledges a cleared incident. The strict reader and all Worker callers stay
// unchanged; ordinary refreshes retain checkpoint/hash continuity checks.
const INCIDENT_CODES = new Set([
  "CHAIN_MISMATCH", "CONSISTENCY_MISMATCH", "FUTURE_CHECKPOINT",
  "CHECKPOINT_ROLLBACK", "CHECKPOINT_MISMATCH", "EPOCH_ROLLBACK", "HASH_DRIFT",
  "CLOCK_INVALID", "CLOCK_ROLLBACK", "CLOCK_JUMP",
]);
let readerNeedsRestart = false;
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
  document.getElementById("network-details").replaceChildren();
}
function renderNetwork(value) {
  const now = Date.now();
  exact(value, ["kind", "source", "chainId", "observedAt", "expiresAt", "verification", "finalityVerified", "registryReady", "checkpoint", "epochsClosed", "agentsJoined", "transactions", "reportedFinalTransactions", "attestationThreshold", "engineSha256", "paramsSha256"]);
  exact(value.checkpoint, ["height", "cutoffTs"]);
  const counts = [value.observedAt, value.expiresAt, value.checkpoint.height, value.checkpoint.cutoffTs, value.epochsClosed, value.agentsJoined, value.transactions, value.reportedFinalTransactions, value.attestationThreshold];
  if (value.kind !== "native-network-observation" || value.source !== "https://minepoa.com" || value.chainId !== "poa-mainnet-1" || value.verification !== "node-reported-unverified" || value.finalityVerified !== false || value.registryReady !== false || !counts.every(n => Number.isSafeInteger(n) && n >= 0) || value.expiresAt !== value.observedAt + 900000 || value.observedAt > now + 300000 || now > value.expiresAt || value.checkpoint.cutoffTs * 1000 > value.observedAt + 300000 || value.reportedFinalTransactions > value.transactions || value.attestationThreshold < 1 || value.attestationThreshold > 256 || !/^[a-f0-9]{64}$/.test(value.engineSha256) || !/^[a-f0-9]{64}$/.test(value.paramsSha256)) throw Error("Observation unavailable");
  document.getElementById("network-status").textContent = "Official-node observation (unverified). Native registry still unavailable.";
  const details = document.getElementById("network-details");
  details.replaceChildren();
  const row = (label, text) => {
    const term = document.createElement("dt"), detail = document.createElement("dd");
    term.textContent = label; detail.textContent = String(text); details.append(term, detail);
    return detail;
  };
  const observed = new Date(value.observedAt), time = document.createElement("time");
  time.dateTime = observed.toISOString();
  time.textContent = observed.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  row("Observed in your time zone", "").append(time);
  for (const [label, text] of [
    ["Network", value.chainId], ["Reported checkpoint", value.checkpoint.height],
    ["Closed epochs", value.epochsClosed], ["Joined agents", value.agentsJoined],
    ["Reported transactions", value.transactions], ["Reported engine SHA-256", value.engineSha256],
    ["Reported params SHA-256", value.paramsSha256],
  ]) row(label, text);
  expiryTimer = setTimeout(() => clearNetwork("This reading expired. Refresh network to check again."), Math.min(value.expiresAt - now + 1, 900001));
}
async function refreshOnce() {
  clearNetwork("Checking…");
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
      "Verified application guard: this page is read-only. Native registry unavailable.";
    try { renderNetwork(await liveReader.observe()); }
    catch (failure) {
      const code = failure instanceof LiveNetworkError ? failure.code : "INVALID_RESPONSE";
      readerNeedsRestart = INCIDENT_CODES.has(code);
      const detail = readerNeedsRestart
        ? "Node checks disagree. Values were cleared. Refresh network to take a fresh reading."
        : code === "HTTP_RATE_LIMITED"
          ? "Too many reads right now. Refresh network to try again."
          : ["NETWORK_ERROR", "HTTP_UNAVAILABLE", "HTTP_ERROR", "TIMEOUT", "ABORTED"].includes(code)
            ? "The public node is unavailable. Refresh network to try again."
            : "The public node sent a response we could not check. Refresh network to try again.";
      clearNetwork(detail + " No current network values are shown.");
    }
  } catch {
    clearNetwork("Network check was not started. Refresh network to try again.");
    document.getElementById("status").textContent =
      "Fail-closed: this page is read-only. Native registry unavailable.";
    error.textContent =
      "This page’s availability document could not be validated. Refresh network to try again. No registry request was sent.";
  }
}
function refresh(userRequested = false) {
  if (refreshFlight) return refreshFlight;
  if (userRequested && readerNeedsRestart) {
    liveReader = createLiveNetworkReader();
    readerNeedsRestart = false;
  }
  const button = document.getElementById("refresh");
  button.disabled = true;
  document.getElementById("observationSection").setAttribute("aria-busy", "true");
  document.getElementById("status").textContent = "Checking…";
  refreshFlight = refreshOnce().finally(() => {
    refreshFlight = undefined;
    button.disabled = false;
    document.getElementById("observationSection").setAttribute("aria-busy", "false");
    const announcement = document.getElementById("refreshAnnouncement");
    const summary = [document.getElementById("status").textContent,error.textContent,document.getElementById("network-status").textContent].filter(Boolean).join(" ");
    if(announcement.textContent!==summary)announcement.textContent=summary;
  });
  return refreshFlight;
}
document.getElementById("refresh").addEventListener("click", () => refresh(true));
await refresh();
