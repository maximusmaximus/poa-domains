import {
  makeBody,
  digest,
  instructions,
  canonical,
  parsePublicJSON,
} from "./shared.js";
const el = (id) => document.getElementById(id);
let cap,
  base = "",
  copy = "";
async function read(path) {
  const r = await fetch(base + path, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
  });
  if (!r.ok) throw Error("Read failed");
  return r.json();
}
try {
  const config = await (
    await fetch("./config.json", { credentials: "omit" })
  ).json();
  if (config.mode !== "local-reference-only") throw Error("Unknown mode");
  if (config.publicApiBase) {
    const u = new URL(config.publicApiBase);
    if (
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (u.protocol !== "https:" &&
        !(u.protocol === "http:" && u.hostname === "127.0.0.1"))
    )
      throw Error("Public endpoint only");
    base = u.origin;
  }
  cap = await read("/v1/capabilities");
  if (cap.livePoA !== false)
    throw Error("Only tested local reference profile is accepted");
  for (const action of Object.keys(cap.actions)) {
    const option = document.createElement("option");
    option.value = action;
    option.textContent = action;
    el("action").append(option);
  }
  const keys = () => {
    el("keys").textContent = JSON.stringify(cap.actions[el("action").value]);
  };
  el("action").addEventListener("change", keys);
  keys();
  const refresh = async () => {
    el("state").textContent = JSON.stringify(await read("/v1/state"), null, 2);
  };
  el("refresh").addEventListener("click", () =>
    refresh().catch(() => {
      el("error").textContent = "Read failed";
    }),
  );
  await refresh();
  el("handoff").addEventListener("submit", async (event) => {
    event.preventDefault();
    el("error").textContent = "";
    copy = "";
    el("body").textContent = "";
    el("instructions").textContent = "";
    el("digest").textContent = "";
    try {
      const input = {};
      for (const id of [
        "signer",
        "requestId",
        "maxTotal",
        "maxNetworkFee",
        "action",
      ])
        input[id] = el(id).value;
      for (const id of ["nonce", "notBefore", "deadline"]) {
        if (!/^(0|[1-9][0-9]*)$/.test(el(id).value))
          throw Error("Explicit canonical integer required");
        input[id] = Number(el(id).value);
      }
      input.coSigners = parsePublicJSON(el("coSigners").value);
      input.params = parsePublicJSON(el("params").value);
      const body = makeBody(input, cap);
      const id = await digest(body);
      const note = instructions(body, id);
      el("body").textContent = canonical(body);
      el("digest").textContent = id;
      el("instructions").textContent = note;
      copy = note + "\n" + canonical(body);
    } catch {
      el("error").textContent =
        "Invalid public input. Check exact schema, canonical fields, principals, versions, caps and validity. No request was sent.";
    }
  });
  el("copy").addEventListener("click", async () => {
    if (copy) await navigator.clipboard.writeText(copy);
  });
} catch {
  el("error").textContent =
    "Public reference endpoint unavailable or unsupported. Nothing can be submitted here.";
}
