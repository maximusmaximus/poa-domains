import { copyText } from "./ui-copy.js?v=51ff8692aecf";
import { trapDialog } from "./ui-a11y.js?v=51ff8692aecf";
import { ui } from "./ui-state.js?v=51ff8692aecf";
import { el, endpointBase, ownershipView } from "./ui-core.js?v=51ff8692aecf";
import { buildAgentTermsPrompt, buildListingPrompt, buildSubnameListingPrompt, hasAgreedToTerms, isPoaAddress, parsePublicJSON, resolveDomainView, resolveOwnerInput, saveTermsAgreement, shouldHoldTransactions } from "./shared.js?v=51ff8692aecf";

export function clearHandoff() {
 ui.generation++;
 if (el("handoffCopyStatus")) el("handoffCopyStatus").textContent = "";
 ui.copy = "";
 for (const id of ["body", "instructions", "digest"])
  el(id).textContent = "";
 el("copy").disabled = true;
}

export async function copyDomainListingPrompt(kind) {
 if (ui.registryReadFailed) {
  el("listingPromptStatus").textContent = "🔄 Refresh registry data first.";
  return;
 }
 if (shouldHoldTransactions(ui.networkStatus.lastKnown === true ? "checking" : ui.networkStatus.level) || ui.networkStatus.hold) {
  el("listingPromptStatus").textContent = "Held ⏸️ until the PoA network is back";
  return;
 }
 if (!ui.latestState || !ui.currentDomainName || !ui.cap)
  return;
 const view = resolveDomainView(ui.latestState, ui.currentDomainName, ui.reservedSet, ownershipView());
 if (!view.deed) {
  el("listingPromptStatus").textContent = "Only the owner can list";
  return;
 }
 const priceRaw = el("listPriceInput").value.trim();
 const hoursRaw = el("listValidHours").value.trim() || "168";
 if (kind !== "unlist") {
  if (!/^(0|[1-9][0-9]{0,38})$/.test(priceRaw) || priceRaw === "0") {
   el("listingPromptStatus").textContent = "Enter a registry-unit price greater than 0";
   return;
  }
 }
 if (kind === "unlist" && !view.listing) {
  el("listingPromptStatus").textContent = "Nothing listed";
  return;
 }
 if (kind === "change" && !view.listing) {
  el("listingPromptStatus").textContent = "List first, then change price";
  return;
 }
 if (!/^[1-9][0-9]{0,5}$/.test(hoursRaw)) {
  el("listingPromptStatus").textContent = "Valid-for hours required";
  return;
 }
 const validUntil = ui.latestState.time + Number(hoursRaw) * 3600;
 const text = buildListingPrompt({
  kind,
  name: ui.currentDomainName,
  deed: view.deed,
  offer: view.listing,
  price: priceRaw,
  validUntil,
  endpointUrl: endpointBase(),
 });
 const box = el("listingPromptBox");
 box.textContent = text;
 const res = await copyText(text, box);
 el("listingPromptStatus").textContent = res.ok ? "✅ Copied" : "📋 Press Ctrl/Cmd+C to copy from the box.";
}

/** Owner-side POA subname listing: copies an unsigned agent request; nothing submits here. */
export async function copySubnameListing() {
 const box = el("subnamePromptBox"), status = el("subnamePromptStatus");
 let text;
 try { text = buildSubnameListingPrompt({ parent: ui.currentDomainName, price: el("subnamePriceInput").value, endpointUrl: endpointBase() }); }
 catch (error) { status.textContent = error.message; el("subnamePriceInput").setAttribute("aria-invalid", "true"); return; }
 el("subnamePriceInput").removeAttribute("aria-invalid");
 box.textContent = text; box.hidden = false;
 const res = await copyText(text, box);
 status.textContent = res.ok ? "✅ Copied" : "📋 Press Ctrl/Cmd+C to copy from the box.";
}

const LAST_POA_KEY = "poadomains.lastPoaAddress.v1";
let feedbackChallenge = null;
let releaseFeedbackFocus = null;
let lastPrefilledPoa = "";
let feedbackBusy = false;

export function detectUserPoaAddress() {
 const candidates = [
  el("manageOwner")?.value,
  el("escrowPayer")?.value,
  ui.inferredCartOwner,
  ui.currentOwnerId,
 ];
 try {
  candidates.push(globalThis.localStorage?.getItem?.(LAST_POA_KEY));
 } catch {}
 for (const raw of candidates) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) continue;
  if (isPoaAddress(s)) return s;
  const resolved = resolveOwnerInput(ui.latestState, s, ui.cap)?.owner;
  if (isPoaAddress(resolved)) return resolved;
 }
 return "";
}

function saveLastPoaAddress(addr) {
 if (!isPoaAddress(addr)) return;
 try {
  globalThis.localStorage?.setItem?.(LAST_POA_KEY, addr);
 } catch {}
}

function leadingZeroBits(bytes) {
 let count = 0;
 for (const byte of bytes) {
  if (byte === 0) {
   count += 8;
   continue;
  }
  for (let bit = 7; bit >= 0; bit--) {
   if ((byte & (1 << bit)) === 0) count++;
   else return count;
  }
 }
 return count;
}

export async function solveFeedbackPow(powSalt, bits) {
 const targetBits = Number.isSafeInteger(bits) && bits >= 0 ? Math.min(bits, 24) : 16;
 const enc = new TextEncoder();
 for (let nonce = 0; nonce < 5_000_000; nonce++) {
  const digest = new Uint8Array(
   await crypto.subtle.digest("SHA-256", enc.encode(`${powSalt}:${nonce}`)),
  );
  if (leadingZeroBits(digest) >= targetBits) return String(nonce);
  if (nonce > 0 && nonce % 512 === 0) {
   await new Promise((r) => setTimeout(r, 0));
  }
 }
 throw Error("Verification timed out. Please try again.");
}

function setFeedbackStatus(text, tone = "muted", link = null) {
 const status = el("feedbackStatus");
 if (!status) return;
 status.className = "feedback-status " + (tone === "warn" ? "badge-warn" : tone === "ok" ? "badge-ok" : "muted");
 status.replaceChildren();
 if (text) status.append(text);
 if (link?.href && link?.label && /^https:\/\/github\.com\//.test(link.href)) {
  status.append(" ");
  const a = document.createElement("a");
  a.href = link.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = link.label;
  status.append(a);
 }
}

function clearFeedbackCaptchaImg() {
 el("feedbackCaptchaSlot")?.replaceChildren();
}

export async function loadFeedbackChallenge() {
 const slot = el("feedbackCaptchaSlot");
 const submitBtn = el("feedbackSubmit");
 feedbackChallenge = null;
 clearFeedbackCaptchaImg();
 if (ui.demo) {
  if (submitBtn) submitBtn.disabled = true;
  setFeedbackStatus("🧪 Static demo mode has no backend. Use poadomains.grok.me or GitHub to submit feedback.");
  return;
 }
 setFeedbackStatus("⏳ Loading verification code…");
 try {
  const res = await fetch(endpointBase() + "/v1/feedback/challenge", {
   method: "GET",
   credentials: "omit",
   cache: "no-store",
   signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(10000) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw Error(body?.message || "Could not load verification code.");
  feedbackChallenge = { ...body, loadedAt: Date.now() };
  if (slot && typeof body.captchaUrl === "string" && body.captchaUrl.startsWith("/v1/feedback/captcha/")) {
   const img = document.createElement("img");
   img.id = "feedbackCaptchaImg";
   img.className = "feedback-captcha-img";
   img.width = 180;
   img.height = 56;
   img.alt = "Verification code";
   img.src = endpointBase() + body.captchaUrl;
   slot.replaceChildren(img);
  }
  if (submitBtn) submitBtn.disabled = body.enabled === false;
  if (body.enabled === false) {
   setFeedbackStatus("ℹ️ Public feedback filing is not enabled on this server yet.", "warn");
  } else {
   setFeedbackStatus("");
  }
 } catch (error) {
  if (submitBtn) submitBtn.disabled = true;
  setFeedbackStatus("⚠️ " + (error?.message || "Could not load verification code."), "warn");
 }
}

export function setFeedbackModalOpen(open) {
 const modal = el("feedbackModal");
 const backdrop = el("feedbackBackdrop");
 const opener = el("openFeedbackBtn");
 if (!modal || !backdrop) return;
 const wasOpen = !modal.hidden;
 if (open === wasOpen) return;
 modal.hidden = !open;
 backdrop.hidden = !open;
 if (open) {
  const poaInput = el("feedbackPoa");
  const detected = detectUserPoaAddress();
  if (poaInput && detected && (!poaInput.value.trim() || poaInput.value.trim() === lastPrefilledPoa)) {
   poaInput.value = detected;
   lastPrefilledPoa = detected;
  }
  releaseFeedbackFocus = trapDialog(modal, backdrop, opener);
  void loadFeedbackChallenge();
 } else {
  clearFeedbackCaptchaImg();
  releaseFeedbackFocus?.();
  releaseFeedbackFocus = null;
 }
}

export function wireFeedbackModal() {
 const openBtn = el("openFeedbackBtn");
 const closeBtn = el("feedbackClose");
 const backdrop = el("feedbackBackdrop");
 const refreshBtn = el("feedbackRefreshCaptcha");
 const form = el("feedbackForm");
 if (!openBtn || !form || form.dataset.wired === "1") return;
 form.dataset.wired = "1";

 for (const id of ["manageOwner", "escrowPayer"]) {
  el(id)?.addEventListener("change", () => saveLastPoaAddress(el(id)?.value?.trim()));
 }
 openBtn.addEventListener("click", () => setFeedbackModalOpen(true));
 closeBtn?.addEventListener("click", () => setFeedbackModalOpen(false));
 backdrop?.addEventListener("click", () => setFeedbackModalOpen(false));
 refreshBtn?.addEventListener("click", () => {
  const ans = el("feedbackCaptchaAnswer");
  if (ans) ans.value = "";
  void loadFeedbackChallenge();
  ans?.focus();
 });

 const submitFeedback = async (event) => {
  event?.preventDefault();
  if (feedbackBusy) return;
  const kind = form.querySelector('input[name="feedbackKind"]:checked')?.value === "feature" ? "feature" : "bug";
  const poaAddress = el("feedbackPoa")?.value.trim() ?? "";
  const title = el("feedbackTitle")?.value.trim() ?? "";
  const details = el("feedbackDetails")?.value.trim() ?? "";
  const captchaAnswer = el("feedbackCaptchaAnswer")?.value.trim() ?? "";
  const website = el("feedbackWebsite")?.value ?? "";

  if (poaAddress && !isPoaAddress(poaAddress)) {
   setFeedbackStatus("⚠️ Enter a valid public poa1… address (or leave it blank).", "warn");
   el("feedbackPoa")?.focus();
   return;
  }
  if (title.length < 5 || title.length > 120) {
   setFeedbackStatus("⚠️ Enter a summary between 5 and 120 characters.", "warn");
   el("feedbackTitle")?.focus();
   return;
  }
  if (details.length < 15 || details.length > 3000) {
   setFeedbackStatus("⚠️ Enter details between 15 and 3000 characters.", "warn");
   el("feedbackDetails")?.focus();
   return;
  }
  if (!/^[A-Za-z0-9]{4,8}$/.test(captchaAnswer)) {
   setFeedbackStatus("⚠️ Enter the verification code shown in the image.", "warn");
   el("feedbackCaptchaAnswer")?.focus();
   return;
  }
  if (!feedbackChallenge) {
   setFeedbackStatus("⚠️ Load a verification code first.", "warn");
   void loadFeedbackChallenge();
   return;
  }

  const submitBtn = el("feedbackSubmit");
  feedbackBusy = true;
  if (submitBtn) submitBtn.disabled = true;
  try {
   setFeedbackStatus("⏳ Verifying challenge…");
   const powNonce = await solveFeedbackPow(feedbackChallenge.powSalt, feedbackChallenge.powBits);
   const remainingDwell = (feedbackChallenge.minDwellMs ?? 0) - (Date.now() - feedbackChallenge.loadedAt);
   if (remainingDwell > 0 && remainingDwell <= 5000) {
    await new Promise((r) => setTimeout(r, remainingDwell));
   }
   setFeedbackStatus("📨 Submitting for review…");
   const res = await fetch(endpointBase() + "/v1/feedback", {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
     kind,
     title,
     details,
     poaAddress,
     pagePath: location.pathname,
     challengeId: feedbackChallenge.challengeId,
     captchaAnswer,
     powNonce,
     website,
    }),
   });
   const body = await res.json();
   if (!res.ok) {
    setFeedbackStatus("⚠️ " + (body?.message || "Could not submit feedback."), "warn");
    if (["FEEDBACK_CAPTCHA_INVALID", "FEEDBACK_CAPTCHA_EXPIRED", "FEEDBACK_POW_INVALID", "FEEDBACK_TOO_FAST"].includes(body?.code)) {
     const ans = el("feedbackCaptchaAnswer");
     if (ans) ans.value = "";
     void loadFeedbackChallenge();
    }
    return;
   }
   saveLastPoaAddress(poaAddress);
   if (el("feedbackTitle")) el("feedbackTitle").value = "";
   if (el("feedbackDetails")) el("feedbackDetails").value = "";
   if (el("feedbackCaptchaAnswer")) el("feedbackCaptchaAnswer").value = "";
   feedbackChallenge = null;
   clearFeedbackCaptchaImg();
   setFeedbackStatus(
    "✅ Submitted to the repository for review!",
    "ok",
    body?.issueUrl && body?.issueNumber
     ? { href: body.issueUrl, label: `View GitHub issue #${body.issueNumber}` }
     : null,
   );
  } catch (error) {
   setFeedbackStatus("⚠️ " + (error?.message || "Could not submit feedback."), "warn");
  } finally {
   feedbackBusy = false;
   if (submitBtn && !ui.demo) submitBtn.disabled = false;
  }
 };
 form.addEventListener("submit", submitFeedback);
 el("feedbackSubmit")?.addEventListener("click", submitFeedback);
}

let releaseTermsFocus = null;
let termsSubmitBusy = false;

export function isTermsGateOpen() {
 const modal = el("termsGateModal");
 return Boolean(modal && !modal.hidden);
}

function setTermsAgentStatus(text, tone = "muted") {
 const node = el("termsAgentStatus");
 if (!node) return;
 node.className = "feedback-status " + (tone === "warn" ? "badge-warn" : tone === "ok" ? "badge-ok" : "muted");
 node.textContent = text;
}

function closeTermsGate(actor = null) {
 const modal = el("termsGateModal");
 const backdrop = el("termsGateBackdrop");
 saveTermsAgreement(globalThis.localStorage, actor);
 if (actor && isPoaAddress(actor)) saveLastPoaAddress(actor);
 if (modal) modal.hidden = true;
 if (backdrop) backdrop.hidden = true;
 document.body.classList.remove("terms-gate-open");
 releaseTermsFocus?.();
 releaseTermsFocus = null;
}

export function wireTermsGate() {
 const modal = el("termsGateModal");
 const backdrop = el("termsGateBackdrop");
 const agreeBtn = el("termsAgreeBtn");
 if (!modal || !backdrop || !agreeBtn) return;

 if (modal.dataset.wired !== "1") {
  modal.dataset.wired = "1";
  agreeBtn.addEventListener("click", () => {
   closeTermsGate();
  });

  el("termsAgentCopyBtn")?.addEventListener("click", async () => {
   const actorInput = el("termsAgentActor");
   const actor = actorInput?.value.trim() || detectUserPoaAddress() || "";
   if (actorInput && actor && !actorInput.value.trim()) actorInput.value = actor;
   const promptText = buildAgentTermsPrompt({
    actor: actor || "<YOUR_POA_ADDRESS>",
    endpointUrl: endpointBase() || location.origin,
    chainId: ui.cap?.chainId || "poa-mainnet-1",
   });
   const pre = el("termsAgentPrompt");
   if (pre) {
    pre.textContent = promptText;
    pre.hidden = false;
   }
   const res = await copyText(promptText, pre);
   setTermsAgentStatus(
    res.ok ? "✅ Signing prompt copied for your agent." : "📋 Select and copy the prompt above for your agent.",
    res.ok ? "ok" : "muted",
   );
  });

  el("termsAgentSubmitBtn")?.addEventListener("click", async () => {
   if (termsSubmitBusy) return;
   if (ui.demo) {
    setTermsAgentStatus("🧪 Static demo mode has no backend. Click I Agree to browse the demo, or submit signed attestations on poadomains.grok.me.", "warn");
    return;
   }
   const raw = el("termsAgentPacket")?.value.trim() ?? "";
   if (!raw) {
    setTermsAgentStatus("⚠️ Paste the signed {statement, signature} JSON from your agent first.", "warn");
    el("termsAgentPacket")?.focus();
    return;
   }
   let packet;
   try {
    packet = parsePublicJSON(raw);
   } catch (error) {
    setTermsAgentStatus("⚠️ " + (error?.message || "Invalid JSON or forbidden secret field."), "warn");
    return;
   }
   const submitBtn = el("termsAgentSubmitBtn");
   termsSubmitBusy = true;
   if (submitBtn) submitBtn.disabled = true;
   setTermsAgentStatus("⏳ Verifying signed Terms agreement…");
   try {
    const res = await fetch(endpointBase() + "/v1/terms/agree", {
     method: "POST",
     credentials: "omit",
     cache: "no-store",
     headers: { "content-type": "application/json" },
     body: JSON.stringify(packet),
    });
    const body = await res.json();
    if (!res.ok || body?.ok !== true) {
     setTermsAgentStatus("⚠️ " + (body?.message || "Could not verify signed agreement."), "warn");
     return;
    }
    setTermsAgentStatus("✅ Signed Terms agreement recorded.", "ok");
    closeTermsGate(body.actor || null);
   } catch (error) {
    setTermsAgentStatus("⚠️ " + (error?.message || "Could not submit signed agreement."), "warn");
   } finally {
    termsSubmitBusy = false;
    if (submitBtn) submitBtn.disabled = false;
   }
  });
 }

 if (!hasAgreedToTerms(globalThis.localStorage)) {
  modal.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add("terms-gate-open");
  if (!releaseTermsFocus) {
   releaseTermsFocus = trapDialog(
    modal,
    backdrop,
    document.querySelector('.section-tab[aria-selected="true"]') || document.querySelector(".section-tab") || el("siteTitle"),
   );
  }
  agreeBtn.focus();
 }
}
