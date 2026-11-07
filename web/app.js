import {
  makeBody,
  digest,
  instructions,
  canonical,
  parsePublicJSON,
  safeObject,
} from "./shared.js";
const el = (id) => document.getElementById(id);
let cap,
  base = "",
  copy = "",
  demo = false,
  examples = {},
  details = {};
let generation = 0;
function clearHandoff() {
  generation++;
  copy = "";
  for (const id of ["body", "instructions", "digest"]) el(id).textContent = "";
  el("copy").disabled = true;
}

async function json(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw Error("Read failed");
  const result = await response.json();
  safeObject(result);
  return result;
}
function staticURL(path) {
  if (typeof path !== "string" || !/^\.\/demo\/[a-z-]+\.json$/.test(path))
    throw Error("Static path");
  const url = new URL(path, location.href),
    root = new URL("./", location.href);
  if (
    url.origin !== location.origin ||
    !url.pathname.startsWith(root.pathname) ||
    url.search ||
    url.hash
  )
    throw Error("Static origin");
  return url.href;
}
function add(parent, tag, text, css) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (css) node.className = css;
  parent.append(node);
  return node;
}
function person(id) {
  const role = Object.keys(details.roles ?? {}).find(
    (x) => details.roles[x] === id,
  );
  return role ? "Fixture " + role : id.slice(0, 18) + "…";
}
function render(payload) {
  const s = payload.state;
  el("state").textContent = JSON.stringify(payload, null, 2);
  el("freshness").textContent =
    (demo ? "STATIC SYNTHETIC DEMO · " : "LOCAL COMMITTED STATE · ") +
    `fixture/commit second ${s.time}, sequence ${s.sequence}. ${payload.finality}. No blockchain-finality proof; refresh reloads stored data, not live chain state.`;
  if (demo && details.generatedAt)
    el("freshness").textContent +=
      " Built " +
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(details.generatedAt)) +
      " Pacific time.";
  const names = Object.values(s.names).filter((n) => n.activeId),
    auctions = Object.values(s.auctions);
  el("stats").replaceChildren();
  for (const [value, label] of [
    [names.length, "owned fixture names"],
    [
      auctions.filter((a) => a.status === "live").length,
      "unsettled fixture auctions",
    ],
    [Object.keys(cap.actions).length, "implemented handoff actions"],
  ]) {
    const box = add(el("stats"), "div", "");
    add(box, "strong", String(value));
    add(box, "span", label);
  }
  el("names").replaceChildren();
  for (const n of names) {
    const d = s.deeds[n.activeId],
      card = add(el("names"), "article", "", "card");
    add(card, "h4", n.name);
    add(
      card,
      "p",
      (demo ? "Synthetic " : "") + d.rights.kind + " deed · " + person(d.owner),
      "badge",
    );
    add(
      card,
      "p",
      `Generation ${d.generation} · owner version ${d.ownerVersion} · deed version ${d.version}`,
    );
    if (d.parentId)
      add(
        card,
        "p",
        "Protected child of " +
          s.deeds[d.parentId].name +
          "; parent transfer does not remove these rights.",
      );
    if (d.rights.kind === "lease")
      add(
        card,
        "p",
        `Absolute fixture expiry ${d.expiry}; grace ${d.rights.graceSeconds}s; resolution during grace ${d.rights.resolveDuringGrace}; renewal ${d.rights.renewal.kind}.`,
      );
    for (const r of d.records)
      add(card, "p", r.type + ": " + (r.url ?? r.address ?? r.cid), "record");
    add(card, "code", d.metadata[d.metadata.length - 1].cid);
  }
  if (!names.length)
    add(el("names"), "p", "No owned names in this committed snapshot.");
  el("auctions").replaceChildren();
  for (const a of auctions) {
    const card = add(el("auctions"), "article", "", "card");
    const close = a.high
      ? Math.max(a.openAt + a.window, a.high.at + a.quiet)
      : a.openAt + a.window;
    const phase =
      a.status !== "live"
        ? a.status
        : s.time < a.openAt
          ? "announced"
          : s.time < close
            ? a.high
              ? "open / funded"
              : "open / no bids"
            : "eligible to close";
    add(card, "h4", a.name);
    add(card, "p", phase, "badge");
    add(
      card,
      "p",
      `Reserve ${a.reserve} ${a.asset} synthetic base units. ${a.high ? "High bid " + a.high.amount + " by " + person(a.high.payer) : "No active high bid."}`,
    );
    add(
      card,
      "p",
      `Minimum window ${a.window}s + quiet ${a.quiet}s; eligibility at fixture second ${close}.`,
    );
  }
}
try {
  const config = await json(new URL("./config.json", location.href));
  demo = config.mode === "static-synthetic-demo";
  let read;
  if (demo) {
    if (config.publicApiBase !== null) throw Error("Demo has no backend");
    const files = config.files;
    [cap, details, examples] = await Promise.all([
      json(staticURL(files.capabilities)),
      json(staticURL(files.details)),
      json(staticURL(files.examples)),
    ]);
    read = () => json(staticURL(files.state));
    el("mode").textContent =
      "SYNTHETIC DEMO · Read-only GitHub Pages. Not live PoA ownership, assets or transactions. No backend, wallet connection, signing or browser writes. All balances and principals are throwaway fixtures; signing keys were discarded.";
    el("example").hidden = false;
    el("exampleNotice").textContent =
      "Explore all 17 implemented action schemas using synthetic examples. They illustrate exact unsigned data only. Nothing here can execute; do not sign/submit demo bodies or use a real key.";
  } else {
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
    cap = await json(base + "/v1/capabilities");
    read = () => json(base + "/v1/state");
  }
  if (cap.livePoA !== false)
    throw Error("Only local reference profile is supported");
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
  el("handoff").addEventListener("input", clearHandoff);
  el("handoff").addEventListener("change", clearHandoff);
  keys();
  const refresh = async () => render(await read());
  el("refresh").addEventListener("click", () =>
    refresh().catch(() => {
      el("error").textContent = "Read failed";
    }),
  );
  await refresh();
  el("example").addEventListener("click", () => {
    const x = examples[el("action").value];
    if (!x) return;
    for (const key of [
      "signer",
      "requestId",
      "nonce",
      "notBefore",
      "deadline",
      "maxTotal",
      "maxNetworkFee",
    ])
      el(key).value = String(x[key]);
    el("coSigners").value = JSON.stringify(x.coSigners);
    el("params").value = JSON.stringify(x.params, null, 2);
    el("body").textContent = "";
    el("instructions").textContent = "";
    el("digest").textContent = "";
    clearHandoff();
  });
  el("handoff").addEventListener("submit", async (event) => {
    event.preventDefault();
    el("error").textContent = "";
    clearHandoff();
    const selectedGeneration = generation;
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
        if (!/^(0|[1-9][0-9]*)$/.test(el(id).value)) throw Error("Integer");
        input[id] = Number(el(id).value);
      }
      input.coSigners = parsePublicJSON(el("coSigners").value);
      input.params = parsePublicJSON(el("params").value);
      const body = makeBody(input, cap),
        id = await digest(body),
        note = instructions(body, id, config.mode);
      if (selectedGeneration !== generation) return;
      el("copy").disabled = false;
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
    if (copy)
      try {
        await navigator.clipboard.writeText(copy);
      } catch {
        el("error").textContent =
          "Clipboard unavailable; copy the inert text manually.";
      }
  });
} catch {
  el("error").textContent =
    "Reference data unavailable or unsupported. Nothing can be submitted here.";
}
