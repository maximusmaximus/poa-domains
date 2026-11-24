import { ui } from "./ui-state.js?v=775cd3b55381";
import { add, el, endpointBase } from "./ui-core.js?v=775cd3b55381";
import { nameLink, openPoa } from "./ui-router.js?v=775cd3b55381";
import { actionLabel, copyText, flashCopied } from "./ui-copy.js?v=775cd3b55381";
import { createInlineInfo } from "./ui-help.js?v=775cd3b55381";
import {
  buildProfileUpdatePrompt,
  checkBtcAddress,
  checkEthAddress,
  checkProfileDescription,
  checkProfileImage,
  cidForDocument,
  extractDomainProfile,
  MAX_PROFILE_DESCRIPTION_CHARS,
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_SCHEMA_V1,
  profileImageMediaPath,
  validPrincipal,
} from "./shared.js?v=775cd3b55381";

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function managedNames(state, owner) {
  return Object.values(state?.names ?? {})
    .map((n) => state.deeds?.[n.activeId])
    .filter((d) => d && !d.retired && d.owner === owner);
}

export function managementPlan(action, deed, state, owner, price = "100", hours = "168") {
  if (deed.owner !== owner || deed.retired)
    throw Error("This address is not the active registry holder.");
  if (!/^[1-9][0-9]{0,38}$/.test(price) || !/^[1-9][0-9]{0,4}$/.test(hours))
    throw Error("Use a whole-number registry-unit price and a positive number of hours.");
  const identity = { name: deed.name, expectedDeedId: deed.id, expectedVersion: deed.version };
  let params, coSigners = [];
  if (action === "createChildOffer") {
    if (deed.parentId) throw Error("Only a root can offer direct subdomains.");
    params = {
      parent: deed.name,
      parentDeedId: deed.id,
      expectedOwnerVersion: deed.ownerVersion,
      asset: "POA",
      price,
      validUntil: state.time + Number(hours) * 3600,
      rights: { kind: "permanent" },
      labels: null,
      maxUses: 1,
    };
  } else if (action === "sellFixed") {
    params = { ...identity, asset: "POA", price, validUntil: state.time + Number(hours) * 3600 };
  } else if (action === "revokeChild") {
    const parent = state.deeds[deed.parentId];
    if (!parent) throw Error("Only a subdomain can be retired.");
    params = { ...identity, parentOwnerVersion: parent.ownerVersion };
    coSigners = [parent.owner];
  } else {
    throw Error("Unsupported management action.");
  }
  return { action, signer: owner, coSigners, params };
}

function showManagePrompt(text) {
  const promptEl = el("managePrompt");
  const actionsEl = el("managePromptActions");
  const statusEl = el("managePromptStatus");
  if (promptEl) promptEl.textContent = text;
  if (actionsEl) actionsEl.hidden = !text;
  if (statusEl) statusEl.textContent = "";
}

function buildProfileEditor(card, deed, owner, startOpen) {
  const extracted = extractDomainProfile(deed);
  const current = extracted?.profile ?? {
    poa: deed.owner,
    btc: null,
    eth: null,
    description: "",
    image: null,
  };
  const details = document.createElement("details");
  details.className = "profile-editor";
  if (startOpen) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = extracted && !extracted.isDefault
    ? `🪪 Public profile (v1 · #${extracted.metadataVersion})`
    : "🪪 Public profile (v1 — set addresses, bio & avatar)";
  details.append(summary);

  const form = add(details, "div", "", "profile-form");
  const noticeRow = add(form, "div", "", "profile-public-notice");
  add(
    noticeRow,
    "span",
    "🌐 Public record: Everything you save here is public and will be published publicly in the registry, backed up to R2, and pinned to IPFS.",
  );
  noticeRow.append(
    createInlineInfo(
      `profile-v1-${deed.id.slice(0, 12)}`,
      `About public profile v1 for ${deed.name}`,
      "Profile fields use versioned schema poa-domains.profile.v1 (v1: POA, BTC mainnet, EIP-55 ETH/EVM, 280-char plain-text bio, and PNG/JPG/WebP/GIF avatar up to 5 MB). Saved profiles are published publicly on-registry, backed up to R2, pinned to IPFS, and accessible to agents via MCP (get_domain_profile, build_profile_witness, update_domain_profile).",
    ),
  );

  const markDirty = () => {
    const box = el("manageNames");
    if (box) box.dataset.dirty = "1";
  };

  // 1. POA address (defaults to owner wallet)
  const poaLabel = add(form, "label", "POA address (defaults to owner wallet)");
  const poaInput = add(poaLabel, "input", "");
  poaInput.type = "text";
  poaInput.autocomplete = "off";
  poaInput.placeholder = deed.owner;
  poaInput.value = current.poa || deed.owner;
  poaInput.dataset.profileField = "poa";
  poaInput.addEventListener("input", markDirty);
  add(form, "small", "Where POA payments sent to this name go.", "muted profile-hint");

  // 2. BTC address
  const btcLabel = add(form, "label", "BTC address (optional — mainnet bc1… or legacy 1…/3…)");
  const btcInput = add(btcLabel, "input", "");
  btcInput.type = "text";
  btcInput.autocomplete = "off";
  btcInput.placeholder = "bc1q… or 1… / 3…";
  btcInput.value = current.btc ?? "";
  btcInput.dataset.profileField = "btc";
  btcInput.addEventListener("input", markDirty);

  // 3. ETH address (with EIP-55 checksum assist)
  const ethLabel = add(form, "label", "ETH address (optional — 0x… with EIP-55 checksum; also works on Base/EVM)");
  const ethInput = add(ethLabel, "input", "");
  ethInput.type = "text";
  ethInput.autocomplete = "off";
  ethInput.placeholder = "0x… (EIP-55 checksummed)";
  ethInput.value = current.eth ?? "";
  ethInput.dataset.profileField = "eth";
  const ethFixRow = add(form, "div", "", "profile-eth-fix");
  ethFixRow.hidden = true;
  const ethFixNote = add(ethFixRow, "span", "", "badge-warn");
  const ethFixBtn = add(ethFixRow, "button", "Apply EIP-55 checksum", "secondary small");
  ethFixBtn.type = "button";
  let pendingChecksum = "";
  const refreshEthHint = () => {
    const res = checkEthAddress(ethInput.value);
    if (!res.ok && res.checksum) {
      pendingChecksum = res.checksum;
      ethFixNote.textContent = "Checksum mismatch — ";
      ethFixRow.hidden = false;
    } else {
      pendingChecksum = "";
      ethFixRow.hidden = true;
    }
  };
  ethInput.addEventListener("input", () => {
    markDirty();
    refreshEthHint();
  });
  ethFixBtn.addEventListener("click", () => {
    if (pendingChecksum) {
      ethInput.value = pendingChecksum;
      markDirty();
      refreshEthHint();
    }
  });

  // 4. Description (plain text bio <= 280 chars)
  const descLabel = add(form, "label", "Description (plain-text bio, max 280 chars — links cannot run as code)");
  const descInput = add(descLabel, "textarea", "");
  descInput.rows = 3;
  descInput.maxLength = MAX_PROFILE_DESCRIPTION_CHARS;
  descInput.placeholder = "Short plain-text bio…";
  descInput.value = current.description ?? "";
  descInput.dataset.profileField = "description";
  const descCount = add(form, "small", `${[...descInput.value].length} / ${MAX_PROFILE_DESCRIPTION_CHARS}`, "muted profile-hint");
  descInput.addEventListener("input", () => {
    markDirty();
    descCount.textContent = `${[...descInput.value].length} / ${MAX_PROFILE_DESCRIPTION_CHARS}`;
  });

  // 5. Image / Avatar (URL or upload PNG/JPG/WebP/GIF <= 5 MB pinned to IPFS + R2)
  const imgLabel = add(form, "label", "Avatar image (https:// or ipfs:// link, or upload PNG/JPG/WebP/GIF up to 5 MB)");
  const imgInput = add(imgLabel, "input", "");
  imgInput.type = "text";
  imgInput.autocomplete = "off";
  imgInput.placeholder = "ipfs://bafkrei… or https://…";
  imgInput.value = current.image ?? "";
  imgInput.dataset.profileField = "image";
  imgInput.addEventListener("input", () => {
    markDirty();
    renderAvatarPreview(imgInput.value.trim());
  });

  const uploadRow = add(form, "div", "", "profile-upload-row");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
  fileInput.className = "visually-hidden";
  fileInput.setAttribute("aria-label", `Upload avatar image for ${deed.name}`);
  const uploadBtn = add(uploadRow, "button", "📤 Upload image to IPFS & R2", "secondary small");
  uploadBtn.type = "button";
  const uploadStatus = add(uploadRow, "span", "", "muted");
  uploadStatus.setAttribute("role", "status");
  uploadRow.append(fileInput);

  const previewBox = add(form, "div", "", "profile-avatar-preview");
  const renderAvatarPreview = (uri) => {
    previewBox.replaceChildren();
    const mediaPath = profileImageMediaPath(uri);
    if (!mediaPath) {
      previewBox.hidden = true;
      return;
    }
    previewBox.hidden = false;
    const img = document.createElement("img");
    img.className = "domain-avatar";
    img.src = mediaPath;
    img.alt = `Avatar preview for ${deed.name}`;
    img.addEventListener("error", () => {
      previewBox.hidden = true;
    });
    previewBox.append(img);
  };
  renderAvatarPreview(imgInput.value.trim());

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
      uploadStatus.textContent = "⚠️ Only PNG, JPG, WebP, or GIF images are allowed.";
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      uploadStatus.textContent = "⚠️ Image must be 5 MB or smaller.";
      return;
    }
    uploadBtn.disabled = true;
    uploadStatus.textContent = "⏳ Uploading & pinning…";
    try {
      const res = await fetch(endpointBase() + "/v1/media/upload", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "content-type": file.type },
        body: file,
      });
      const body = await res.json();
      if (!res.ok) throw Error(body?.message || body?.code || "Upload failed");
      imgInput.value = body.uri;
      markDirty();
      renderAvatarPreview(body.uri);
      uploadStatus.textContent = body.ipfsPinned
        ? "✅ Pinned to IPFS & backed up to R2"
        : "✅ Stored in R2 (IPFS CIDv1 ready)";
    } catch (error) {
      uploadStatus.textContent = "⚠️ " + (error?.message || "Image upload failed");
    } finally {
      uploadBtn.disabled = false;
    }
  });

  const errNode = add(form, "p", "", "badge-warn");
  errNode.setAttribute("role", "alert");
  const actionRow = add(form, "div", "", "button-row");
  const saveBtn = add(actionRow, "button", "🤖 Copy profile prompt for my agent", "small");
  saveBtn.type = "button";
  const statusNode = add(actionRow, "span", "", "muted");
  statusNode.setAttribute("role", "status");

  saveBtn.addEventListener("click", async () => {
    errNode.textContent = "";
    statusNode.textContent = "";
    try {
      if (ui.registryReadFailed)
        throw Error("Refresh registry data before preparing a profile update.");
      const fresh = ui.latestState?.deeds?.[deed.id] ?? deed;
      const poaVal = poaInput.value.trim() || fresh.owner;
      if (!poaVal.startsWith("poa1") || !validPrincipal(poaVal))
        throw Error("Enter a valid public poa1… POA address.");
      const btcCheck = await checkBtcAddress(btcInput.value);
      if (!btcCheck.ok) throw Error(btcCheck.error);
      const ethCheck = checkEthAddress(ethInput.value);
      if (!ethCheck.ok) {
        refreshEthHint();
        throw Error(ethCheck.error);
      }
      const descCheck = checkProfileDescription(descInput.value);
      if (!descCheck.ok) throw Error(descCheck.error);
      const imgCheck = checkProfileImage(imgInput.value);
      if (!imgCheck.ok) throw Error(imgCheck.error);

      const doc = {
        schema: PROFILE_SCHEMA_V1,
        version: 1,
        name: fresh.name,
        rightsHash: fresh.rightsHash,
        poa: poaVal,
        btc: btcCheck.value,
        eth: ethCheck.value,
        description: descCheck.value,
        image: imgCheck.value,
      };
      const cid = await cidForDocument(doc);
      const promptText = buildProfileUpdatePrompt({
        name: fresh.name,
        deed: fresh,
        metadata: { cid, document: doc },
        endpointUrl: endpointBase(),
      });
      showManagePrompt(promptText);
      const copied = await copyText(promptText, el("managePrompt"));
      statusNode.textContent = copied.ok
        ? "✅ Prompt copied — paste to your agent to sign & publish"
        : "📋 Copy the prompt below for your agent.";
      const box = el("manageNames");
      if (box) delete box.dataset.dirty;
    } catch (error) {
      errNode.textContent = "⚠️ " + (error?.message || "Check your profile fields.");
    }
  });

  card.append(details);
}

export function renderManagement({ force = false, focusDomain = null } = {}) {
  const box = el("manageNames"),
    owner = el("manageOwner")?.value.trim();
  if (!box) return;
  const activeFocus = focusDomain ?? ui.focusedManageDomain ?? null;
  if (!force && owner && box.dataset.renderedOwner === owner && (box.dataset.dirty === "1" || box.contains(document.activeElement))) {
    return;
  }
  box.replaceChildren();
  delete box.dataset.dirty;
  if (!owner) {
    delete box.dataset.renderedOwner;
    showManagePrompt("");
    return;
  }
  if (!/^(poa1[1-9A-HJ-NP-Za-km-z]{30,60}|ed25519:[0-9a-f]{64})$/.test(owner)) {
    delete box.dataset.renderedOwner;
    showManagePrompt("");
    add(box, "p", "Use a public owner address only — never a private key.", "badge-warn");
    return;
  }
  const names = managedNames(ui.latestState, owner);
  box.dataset.renderedOwner = owner;
  if (force) showManagePrompt("");
  if (!names.length) {
    add(box, "p", "No active names for this address in the current registry snapshot.", "muted");
    return;
  }
  // Put focused domain first if requested via "Manage this domain"
  const ordered = activeFocus
    ? [...names.filter((d) => d.name === activeFocus), ...names.filter((d) => d.name !== activeFocus)]
    : names;
  for (const d of ordered) {
    const isFocused = activeFocus === d.name;
    const card = add(box, "article", "", isFocused ? "card is-focused-domain" : "card");
    card.dataset.domainName = d.name;
    const h = add(card, "h4", "");
    nameLink(h, d.name);
    add(
      card,
      "p",
      d.parentId ? "Subdomain · application-registry record" : "Root domain · application-registry record",
      "badge",
    );
    if (d.parentId) {
      const p = add(card, "p", "Child of ");
      nameLink(p, ui.latestState.deeds[d.parentId]?.name ?? "");
    }
    buildProfileEditor(card, d, owner, isFocused || ordered.length === 1);
    const poa = ui.cap?.poaOnly?.status === "on";
    if (poa) {
      const sell = add(card, "button", "🏷️ Sell for POA", "secondary small");
      sell.type = "button";
      sell.setAttribute("aria-label", "Sell " + d.name + " for POA");
      sell.addEventListener("click", () => openPoa(d.name));
    }
    const label = add(card, "label", "Listing / subdomain price (registry units)"),
      price = add(label, "input", "");
    price.value = "100";
    price.inputMode = "numeric";
    price.setAttribute("aria-label", "Registry-unit listing price for " + d.name);
    label.hidden = poa;
    const controls = add(card, "div", "", "button-row");
    for (const action of ["sellFixed", d.parentId ? "revokeChild" : "createChildOffer"]) {
      if (ui.cap?.ownership?.disabledActions?.includes(action) || !ui.cap?.actions?.[action]) continue;
      const b = add(controls, "button", "Prepare: " + actionLabel(action), "secondary small");
      b.type = "button";
      b.addEventListener("click", () => {
        try {
          if (ui.registryReadFailed) throw Error("Refresh registry data before preparing a request.");
          const fresh = ui.latestState.deeds[d.id];
          const plan = managementPlan(action, fresh, ui.latestState, owner, price.value);
          showManagePrompt(
            [
              actionLabel(action) + " — unsigned request for your agent.",
              "Endpoint: " + endpointBase(),
              "Re-quote, preview and verify current ownership before signing. Ask me before submitting. No action was sent.",
              action === "createChildOffer"
                ? "Offers one permanent direct subdomain; the buyer chooses its label. Existing subdomains do not disappear."
                : action === "revokeChild"
                  ? "Retiring requires the child holder AND parent owner's signatures. A permanent path stays reserved; it does not become available again."
                  : "This prepares a registry-unit listing only; it does not sell the name now.",
              JSON.stringify(plan, null, 2),
            ].join("\n"),
          );
        } catch (e) {
          showManagePrompt(e.message);
        }
      });
    }
    for (const o of Object.values(ui.latestState.offers ?? {}).filter(
      (o) => o.parentId === d.id && !o.cancelled && o.uses < o.maxUses && o.validUntil > ui.latestState.time,
    )) {
      const p = add(card, "p", (o.kind === "child" ? "Open subdomain offer" : "Open sale listing") + ": " + o.price + " POA. ");
      const b = add(p, "button", "Prepare removal", "secondary small");
      b.type = "button";
      b.addEventListener("click", () => {
        showManagePrompt(
          "Remove listing — unsigned. Ask the owner's agent to re-quote and preview, then request approval before submitting. Nothing was sent.\n" +
            JSON.stringify({ action: "cancelOffer", signer: owner, params: { offerId: o.id, expectedVersion: o.version } }, null, 2),
        );
      });
    }
  }
}

export function wireManagement() {
  el("manageLookup")?.addEventListener("click", () => {
    ui.focusedManageDomain = null;
    renderManagement({ force: true });
  });
  el("manageOwner")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.focusedManageDomain = null;
      renderManagement({ force: true });
    }
  });
  el("copyManagePrompt")?.addEventListener("click", async () => {
    const text = el("managePrompt")?.textContent?.trim();
    if (!text) return;
    const res = await copyText(text, el("managePrompt"));
    const status = el("managePromptStatus");
    if (res.ok) {
      flashCopied(el("copyManagePrompt"));
      if (status) status.textContent = "✅ Copied";
    } else if (status) {
      status.textContent = "📋 Press Ctrl/Cmd+C to copy from the box.";
    }
  });
}
