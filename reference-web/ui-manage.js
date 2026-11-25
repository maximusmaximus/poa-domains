import { ui } from "./ui-state.js?v=e24f44d20e2d";
import { add, el, endpointBase } from "./ui-core.js?v=e24f44d20e2d";
import { createDomainAvatar, domainHeader, nameLink, openPoa, syncEscrowPayerAddress, updateDomainAvatarElement } from "./ui-router.js?v=e24f44d20e2d";
import { updateManagedDomainsBadge } from "./ui-render.js?v=e24f44d20e2d";
import { actionLabel, copyText, flashCopied } from "./ui-copy.js?v=e24f44d20e2d";
import { createInlineInfo } from "./ui-help.js?v=e24f44d20e2d";
import {
  buildProfileUpdatePrompt,
  checkBtcAddress,
  checkEthAddress,
  checkProfileDescription,
  checkProfileImage,
  cidForDocument,
  extractDomainProfile,
  findDomainSalesAndAuctions,
  isPoaAddress,
  MAX_PROFILE_DESCRIPTION_CHARS,
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_SCHEMA_V1,
  profileImageMediaPath,
  SALE_FIELDS_WARNING,
  saveKnownOwner,
  validPrincipal,
} from "./shared.js?v=e24f44d20e2d";

const ALLOWED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IDLE_MANAGE_PROMPT = "Edit profile fields or choose an action above to preview the code for your agent.";
let managePromptState = { text: "", payload: null, filename: "poa-domains-manage.json", ready: false };
let profilePreviewSeq = 0;

function safeSlug(name) {
  const s = String(name ?? "domain").replace(/[^a-z0-9._-]/gi, "_").replace(/^_+|_+$/g, "");
  return s || "domain";
}

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

function showManagePrompt(text, { meta = "", payload = null, filename = "", ready = Boolean(text), showPanel } = {}) {
  const panel = el("managePromptPanel");
  const promptEl = el("managePrompt");
  const metaEl = el("managePromptMeta");
  const copyBtn = el("copyManagePrompt");
  const dlBtn = el("downloadManageJSON");
  const clearBtn = el("clearManagePrompt");
  const statusEl = el("managePromptStatus");
  const hasDomains = Boolean(el("manageNames")?.querySelector("article.card"));
  const visible = typeof showPanel === "boolean" ? showPanel : Boolean(text || hasDomains);
  if (panel) panel.hidden = !visible;
  if (!visible) {
    managePromptState = { text: "", payload: null, filename: "poa-domains-manage.json", ready: false };
    if (promptEl) promptEl.textContent = "";
    if (metaEl) metaEl.textContent = IDLE_MANAGE_PROMPT;
    if (copyBtn) copyBtn.disabled = true;
    if (dlBtn) dlBtn.disabled = true;
    if (clearBtn) clearBtn.disabled = true;
    if (statusEl) statusEl.textContent = "";
    return;
  }
  const hasText = Boolean(text);
  const canCopy = Boolean(ready && hasText);
  managePromptState = {
    text: canCopy ? text : "",
    payload: canCopy ? payload : null,
    filename: filename || "poa-domains-manage.json",
    ready: canCopy,
  };
  if (promptEl) promptEl.textContent = hasText ? text : IDLE_MANAGE_PROMPT;
  if (metaEl) {
    metaEl.textContent = meta || (canCopy
      ? "Generated from your actions and fields above — review before approving with your agent."
      : IDLE_MANAGE_PROMPT);
  }
  if (copyBtn) copyBtn.disabled = !canCopy;
  if (dlBtn) dlBtn.disabled = !(canCopy && payload !== null);
  if (clearBtn) clearBtn.disabled = !hasText;
  if (statusEl) statusEl.textContent = "";
}

function downloadManageJSON() {
  if (!managePromptState.ready || managePromptState.payload === null) return;
  const blob = new Blob([JSON.stringify(managePromptState.payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = managePromptState.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const status = el("managePromptStatus");
  if (status) status.textContent = "📥 JSON downloaded — unsigned, nothing submitted.";
}

function addFieldWithInfo(parent, { id, label, infoId, infoLabel, infoText, tag = "input" }) {
  const row = add(parent, "div", "", "field-label-row");
  const labelEl = add(row, "label", label);
  labelEl.setAttribute("for", id);
  row.append(createInlineInfo(infoId, infoLabel, infoText));
  const input = add(parent, tag, "");
  input.id = id;
  return { row, label: labelEl, input };
}

function buildProfileEditor(card, deed, owner, startOpen, { listedForSale = false, headerAvatar = null } = {}) {
  const extracted = extractDomainProfile(deed);
  const current = extracted?.profile ?? {
    poa: deed.owner,
    btc: null,
    eth: null,
    description: "",
    image: null,
  };
  const slug = deed.id.slice(0, 12);
  const details = document.createElement("details");
  details.className = "profile-editor";
  if (startOpen) details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = listedForSale
    ? "⏸️ Public profile · Paused"
    : extracted && !extracted.isDefault
      ? `🪪 Public profile · v${extracted.metadataVersion}`
      : "🪪 Public profile";
  details.append(summary);

  const form = add(details, "div", "", "profile-form");
  if (listedForSale) {
    const pausedNote = add(
      form,
      "p",
      "⏸️ Paused while listed or in auction. Profile fields are dropped when ownership transfers.",
      "sale-fields-warning",
    );
    pausedNote.setAttribute("role", "note");
  }
  const noticeRow = add(form, "div", "", "profile-public-notice has-info");
  add(noticeRow, "span", "🌐 Saved profile fields are public.");
  noticeRow.append(
    createInlineInfo(
      `profile-v1-${slug}`,
      `About public profile for ${deed.name}`,
      "Everything you save here is public and visible to everyone once published. Optional fields: POA, BTC, and ETH/EVM addresses, a short plain-text bio up to 280 characters, and a square avatar image up to 5 MB.",
    ),
  );

  const markDirty = () => {
    const box = el("manageNames");
    if (box) box.dataset.dirty = "1";
  };

  let liveTimer = null;
  const scheduleLivePreview = () => {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      void buildProfilePrompt({ reportInlineError: false });
    }, 90);
  };

  // 1. POA address
  const { input: poaInput } = addFieldWithInfo(form, {
    id: `prof-poa-${slug}`,
    label: "POA address",
    infoId: `prof-poa-info-${slug}`,
    infoLabel: `About POA address for ${deed.name}`,
    infoText: "Defaults to the owner wallet. Where POA payments sent to this name go.",
  });
  poaInput.type = "text";
  poaInput.autocomplete = "off";
  poaInput.placeholder = deed.owner;
  poaInput.value = current.poa || deed.owner;
  poaInput.dataset.profileField = "poa";
  poaInput.addEventListener("input", () => {
    markDirty();
    scheduleLivePreview();
  });

  // 2. BTC address
  const { input: btcInput } = addFieldWithInfo(form, {
    id: `prof-btc-${slug}`,
    label: "BTC address",
    infoId: `prof-btc-info-${slug}`,
    infoLabel: `About BTC address for ${deed.name}`,
    infoText: "Optional — mainnet Bitcoin address: bc1… SegWit/Taproot or legacy 1… / 3….",
  });
  btcInput.type = "text";
  btcInput.autocomplete = "off";
  btcInput.placeholder = "bc1q… or 1… / 3…";
  btcInput.value = current.btc ?? "";
  btcInput.dataset.profileField = "btc";
  btcInput.addEventListener("input", () => {
    markDirty();
    scheduleLivePreview();
  });

  // 3. ETH address (with EIP-55 checksum assist)
  const { input: ethInput } = addFieldWithInfo(form, {
    id: `prof-eth-${slug}`,
    label: "ETH address",
    infoId: `prof-eth-info-${slug}`,
    infoLabel: `About ETH address for ${deed.name}`,
    infoText: "Optional — 0x… address with EIP-55 checksum. Also works on Base and other EVM chains.",
  });
  ethInput.type = "text";
  ethInput.autocomplete = "off";
  ethInput.placeholder = "0x…";
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
    scheduleLivePreview();
  });
  ethFixBtn.addEventListener("click", () => {
    if (pendingChecksum) {
      ethInput.value = pendingChecksum;
      markDirty();
      refreshEthHint();
      scheduleLivePreview();
    }
  });

  // 4. Description
  const { input: descInput } = addFieldWithInfo(form, {
    id: `prof-desc-${slug}`,
    label: "Description",
    infoId: `prof-desc-info-${slug}`,
    infoLabel: `About description for ${deed.name}`,
    infoText: "Optional plain-text bio, max 280 characters. Links are stored as plain text and cannot run as code.",
    tag: "textarea",
  });
  descInput.rows = 3;
  descInput.maxLength = MAX_PROFILE_DESCRIPTION_CHARS;
  descInput.placeholder = "Short plain-text bio…";
  descInput.value = current.description ?? "";
  descInput.dataset.profileField = "description";
  const descCount = add(form, "small", `${[...descInput.value].length} / ${MAX_PROFILE_DESCRIPTION_CHARS}`, "muted profile-hint");
  descInput.addEventListener("input", () => {
    markDirty();
    descCount.textContent = `${[...descInput.value].length} / ${MAX_PROFILE_DESCRIPTION_CHARS}`;
    scheduleLivePreview();
  });

  // 5. Image / Avatar
  const { input: imgInput } = addFieldWithInfo(form, {
    id: `prof-img-${slug}`,
    label: "Avatar image",
    infoId: `prof-img-info-${slug}`,
    infoLabel: `About avatar image for ${deed.name}`,
    infoText: "Square image — paste an https:// or ipfs:// link, or upload PNG, JPG, WebP, or GIF up to 5 MB.",
  });
  imgInput.type = "text";
  imgInput.autocomplete = "off";
  imgInput.placeholder = "https://… or ipfs://…";
  imgInput.value = current.image ?? "";
  imgInput.dataset.profileField = "image";
  imgInput.addEventListener("input", () => {
    markDirty();
    renderAvatarPreview(imgInput.value.trim());
    scheduleLivePreview();
  });

  const uploadRow = add(form, "div", "", "profile-upload-row");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp,image/gif";
  fileInput.className = "visually-hidden";
  fileInput.setAttribute("aria-label", `Upload avatar image for ${deed.name}`);
  const uploadBtn = add(uploadRow, "button", "📤 Upload", "secondary small");
  uploadBtn.type = "button";
  const uploadStatus = add(uploadRow, "span", "", "muted");
  uploadStatus.setAttribute("role", "status");
  uploadRow.append(fileInput);

  const previewBox = add(form, "div", "", "profile-avatar-preview");
  const renderAvatarPreview = (uri) => {
    previewBox.replaceChildren();
    const mediaPath = profileImageMediaPath(uri);
    previewBox.hidden = false;
    previewBox.append(createDomainAvatar(deed.name, { size: "lg", mediaPath }));
    if (headerAvatar && !listedForSale) {
      updateDomainAvatarElement(headerAvatar, deed.name, mediaPath);
    }
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
    uploadStatus.textContent = "⏳ Uploading…";
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
      uploadStatus.textContent = "✅ Image uploaded";
      void buildProfilePrompt({ reportInlineError: false });
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

  async function buildProfilePrompt({ reportInlineError = false } = {}) {
    const seq = ++profilePreviewSeq;
    if (reportInlineError) {
      errNode.textContent = "";
      statusNode.textContent = "";
    }
    try {
      if (ui.registryReadFailed)
        throw Error("Refresh registry data before preparing a profile update.");
      const fresh = ui.latestState?.deeds?.[deed.id] ?? deed;
      const poaVal = poaInput.value.trim() || fresh.owner;
      if (!poaVal.startsWith("poa1") || !validPrincipal(poaVal))
        throw Error("Enter a valid public poa1… POA address.");
      const btcCheck = await checkBtcAddress(btcInput.value);
      if (seq !== profilePreviewSeq) return null;
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
      if (seq !== profilePreviewSeq) return null;
      const metadata = { cid, document: doc };
      const promptText = buildProfileUpdatePrompt({
        name: fresh.name,
        deed: fresh,
        metadata,
        endpointUrl: endpointBase(),
      });
      const payload = {
        action: "setMetadata",
        endpoint: endpointBase(),
        signer: fresh.owner,
        coSigners: [],
        maxTotal: "0",
        maxNetworkFee: "0",
        params: {
          name: fresh.name,
          expectedDeedId: fresh.id,
          expectedVersion: fresh.version,
          metadata,
        },
      };
      errNode.textContent = "";
      showManagePrompt(promptText, {
        meta: `🪪 Live preview · Public profile for "${fresh.name}"`,
        payload,
        filename: `poa-domains-${safeSlug(fresh.name)}-profile.json`,
        ready: true,
        showPanel: true,
      });
      return { promptText, payload };
    } catch (error) {
      if (seq !== profilePreviewSeq) return null;
      const msg = error?.message || "Check your profile fields.";
      if (reportInlineError) {
        errNode.textContent = "⚠️ " + msg;
      }
      showManagePrompt("⚠️ " + msg, {
        meta: `⚠️ Fix field above to generate code for "${deed.name}"`,
        payload: null,
        ready: false,
        showPanel: true,
      });
      return null;
    }
  }

  saveBtn.addEventListener("click", async () => {
    clearTimeout(liveTimer);
    const built = await buildProfilePrompt({ reportInlineError: true });
    if (!built) return;
    const copied = await copyText(built.promptText, el("managePrompt"));
    if (copied.ok) flashCopied(el("copyManagePrompt"));
    statusNode.textContent = copied.ok
      ? "✅ Prompt copied — paste to your agent to sign & publish"
      : "📋 Copy the prompt below for your agent.";
    const promptStatus = el("managePromptStatus");
    if (promptStatus) promptStatus.textContent = copied.ok ? "✅ Copied" : "";
    const box = el("manageNames");
    if (box) delete box.dataset.dirty;
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
    showManagePrompt("", { showPanel: false });
    updateManagedDomainsBadge();
    return;
  }
  if (!/^(poa1[1-9A-HJ-NP-Za-km-z]{30,60}|ed25519:[0-9a-f]{64})$/.test(owner)) {
    delete box.dataset.renderedOwner;
    showManagePrompt("", { showPanel: false });
    add(box, "p", "Use a public owner address only — never a private key.", "badge-warn");
    updateManagedDomainsBadge();
    return;
  }
  if (isPoaAddress(owner)) syncEscrowPayerAddress(owner);
  const names = managedNames(ui.latestState, owner);
  box.dataset.renderedOwner = owner;
  updateManagedDomainsBadge();
  if (!names.length) {
    showManagePrompt("", { showPanel: false });
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
    const h = add(card, "h3", "");
    const { avatar: headerAvatar } = domainHeader(h, d.name);
    add(card, "p", d.parentId ? "Subdomain" : "Root domain", "badge");
    if (d.parentId) {
      const p = add(card, "p", "Child of ");
      nameLink(p, ui.latestState.deeds[d.parentId]?.name ?? "");
    }
    const saleInfo = findDomainSalesAndAuctions({
      name: d.name,
      deed: d,
      state: ui.latestState,
      escrowMarket: ui.escrowMarket,
      nowMs: ui.escrowMarketServerTime || Date.now(),
    });
    const availableToList = !saleInfo.listedForSale && !d.lock;
    if (saleInfo.listedForSale) {
      const liveWarn = add(
        card,
        "p",
        "⏸️ Listed for sale or in auction — profile fields are paused and will be dropped on transfer.",
        "sale-fields-warning",
      );
      liveWarn.setAttribute("role", "note");
    }
    buildProfileEditor(card, d, owner, isFocused || ordered.length === 1, {
      listedForSale: saleInfo.listedForSale,
      headerAvatar,
    });
    const poa = ui.cap?.poaOnly?.status === "on";
    if (availableToList) {
      const sellWarn = add(card, "div", "", "sale-fields-warning has-info");
      sellWarn.setAttribute("role", "note");
      add(sellWarn, "span", "⚠️ Listing or auctioning pauses profile fields and drops them on transfer.");
      sellWarn.append(
        createInlineInfo(
          `manage-sale-warn-${d.id.slice(0, 12)}`,
          `About profile fields when selling or auctioning ${d.name}`,
          "While listed or in auction, active profile fields are paused. When ownership transfers, they are dropped for the next owner and archived as read-only history on the domain page.",
        ),
      );
    }
    if (poa) {
      const poaRow = add(card, "div", "", "button-row manage-poa-actions");
      if (availableToList) {
        const sell = add(poaRow, "button", "🏷️ Sell for POA", "secondary small");
        sell.type = "button";
        sell.setAttribute("aria-label", "Sell for POA: " + d.name);
        sell.addEventListener("click", () => openPoa(d.name, { mode: "sell", owner }));
        const auction = add(poaRow, "button", "🔨 Auction for POA", "secondary small");
        auction.type = "button";
        auction.setAttribute("aria-label", "Auction for POA: " + d.name);
        auction.addEventListener("click", () => openPoa(d.name, { mode: "auction", owner }));
      } else {
        const viewPoa = add(poaRow, "button", "🪙 Open in My POA", "secondary small");
        viewPoa.type = "button";
        viewPoa.setAttribute("aria-label", "Open in My POA: " + d.name);
        viewPoa.addEventListener("click", () => openPoa("", { owner }));
      }
    }
    const priceWrap = add(card, "div", "", "manage-unit-price");
    priceWrap.hidden = poa;
    const { input: price } = addFieldWithInfo(priceWrap, {
      id: `manage-price-${d.id.slice(0, 12)}`,
      label: "Listing / subdomain price",
      infoId: `manage-price-info-${d.id.slice(0, 12)}`,
      infoLabel: `About listing price for ${d.name}`,
      infoText: "Whole-number price in registry units.",
    });
    price.value = "100";
    price.inputMode = "numeric";
    price.setAttribute("aria-label", "Registry-unit listing price for " + d.name);
    const controls = add(card, "div", "", "button-row");
    let activeCardAction = null;
    const buildActionPrompt = (action) => {
      try {
        if (ui.registryReadFailed) throw Error("Refresh registry data before preparing a request.");
        const fresh = ui.latestState.deeds[d.id];
        const plan = managementPlan(action, fresh, ui.latestState, owner, price.value);
        const promptText = [
          actionLabel(action) + " — unsigned request for your agent.",
          "Endpoint: " + endpointBase(),
          "Re-quote, preview and verify current ownership before signing. Ask me before submitting. No action was sent.",
          action === "createChildOffer"
            ? "Offers one permanent direct subdomain; the buyer chooses its label. Existing subdomains do not disappear."
            : action === "revokeChild"
              ? "Retiring requires the child holder AND parent owner's signatures. A permanent path stays reserved; it does not become available again."
              : `This prepares a registry-unit listing only; it does not sell the name now.\n${SALE_FIELDS_WARNING}`,
          JSON.stringify(plan, null, 2),
        ].join("\n");
        showManagePrompt(promptText, {
          meta: `⚙️ Generated · ${actionLabel(action)} for "${d.name}"`,
          payload: { ...plan, endpoint: endpointBase() },
          filename: `poa-domains-${safeSlug(d.name)}-${action}.json`,
          ready: true,
          showPanel: true,
        });
      } catch (e) {
        showManagePrompt(e.message, {
          meta: `⚠️ Could not build ${actionLabel(action)} for "${d.name}"`,
          payload: null,
          ready: false,
          showPanel: true,
        });
      }
    };
    price.addEventListener("input", () => {
      if (activeCardAction) buildActionPrompt(activeCardAction);
    });
    for (const action of ["sellFixed", d.parentId ? "revokeChild" : "createChildOffer"]) {
      if (ui.cap?.ownership?.disabledActions?.includes(action) || !ui.cap?.actions?.[action]) continue;
      const b = add(controls, "button", "Prepare: " + actionLabel(action), "secondary small");
      b.type = "button";
      b.addEventListener("click", () => {
        activeCardAction = action;
        buildActionPrompt(action);
      });
    }
    for (const o of Object.values(ui.latestState.offers ?? {}).filter(
      (o) => o.parentId === d.id && !o.cancelled && o.uses < o.maxUses && o.validUntil > ui.latestState.time,
    )) {
      const p = add(card, "p", (o.kind === "child" ? "Open subdomain offer" : "Open sale listing") + ": " + o.price + " POA. ");
      const b = add(p, "button", "Prepare removal", "secondary small");
      b.type = "button";
      b.addEventListener("click", () => {
        const cancelPlan = { action: "cancelOffer", signer: owner, params: { offerId: o.id, expectedVersion: o.version } };
        showManagePrompt(
          "Remove listing — unsigned. Ask the owner's agent to re-quote and preview, then request approval before submitting. Nothing was sent.\n" +
            JSON.stringify(cancelPlan, null, 2),
          {
            meta: `⚙️ Generated · Remove listing for "${d.name}"`,
            payload: { ...cancelPlan, endpoint: endpointBase() },
            filename: `poa-domains-${safeSlug(d.name)}-cancelOffer.json`,
            ready: true,
            showPanel: true,
          },
        );
      });
    }
  }
  if (force || !managePromptState.ready) {
    showManagePrompt("", { showPanel: true });
  } else {
    const panel = el("managePromptPanel");
    if (panel) panel.hidden = false;
  }
}

export function wireManagement() {
  const ownerRow = el("manageOwnerLabelRow");
  if (ownerRow && !ownerRow.querySelector("#help-manage-owner-field")) {
    ownerRow.append(
      createInlineInfo(
        "manage-owner-field",
        "About public owner address",
        "Enter a public poa1… owner address only — never paste a private key. Viewing an address does not connect a wallet.",
      ),
    );
  }
  const onLookup = () => {
    ui.focusedManageDomain = null;
    const raw = el("manageOwner")?.value.trim() ?? "";
    if (!raw) {
      ui.knownOwner = "";
      ui.inferredCartOwner = "";
      saveKnownOwner(globalThis.localStorage, "");
    } else if (validPrincipal(raw)) {
      ui.knownOwner = raw;
      saveKnownOwner(globalThis.localStorage, raw);
      if (isPoaAddress(raw)) syncEscrowPayerAddress(raw, { force: true });
    }
    renderManagement({ force: true });
  };
  el("manageLookup")?.addEventListener("click", onLookup);
  el("manageOwner")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onLookup();
    }
  });
  el("copyManagePrompt")?.addEventListener("click", async () => {
    const text = managePromptState.text || el("managePrompt")?.textContent?.trim();
    if (!text || !managePromptState.ready) return;
    const res = await copyText(text, el("managePrompt"));
    const status = el("managePromptStatus");
    if (res.ok) {
      flashCopied(el("copyManagePrompt"));
      if (status) status.textContent = "✅ Copied";
    } else if (status) {
      status.textContent = "📋 Press Ctrl/Cmd+C to copy from the box.";
    }
  });
  el("downloadManageJSON")?.addEventListener("click", downloadManageJSON);
  el("clearManagePrompt")?.addEventListener("click", () => {
    showManagePrompt("", { showPanel: Boolean(el("manageNames")?.querySelector("article.card")) });
  });
}
