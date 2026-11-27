/** Agent-first custodial POA screens. No wallet/key input, signing or automatic financial submission. */
export const poaAmount = value => { if (typeof value !== "string" || !/^([0-9]+)(?:\.([0-9]{1,6}))?$/.test(value))
    throw Error("Use a POA amount with up to 6 decimals"); const [w, f = ""] = value.split("."); return BigInt(w).toString() + "." + f.padEnd(6, "0"); };
export const elapsed = (at, now = Date.now()) => { if (!Number.isFinite(at) || at <= 0)
    return "time not recorded"; const minutes = Math.max(0, Math.floor((now - at) / 60000)); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${minutes}m ago`; };
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined)
    n.textContent = String(text); if (cls)
    n.className = cls; return n; };
const append = (p, t, text, cls) => { const n = node(t, text, cls); p.append(n); return n; };
export function mountEscrow({ base = "", capability, registryId, section, domain, selectTab }) {
    let caps = { enabled: false, held: true, holdReason: "POA payments not open" }, intent = null, candidate = null, account = null, viewPacket = null, market = [], busy = false, stopped = false, currentName = "", serverOffset = 0, marketTab = "available";
    const expandedIds = new Set();
    const shortPoa = (v) => String(v ?? "").replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
    const marketBucket = (item, nowMs) => {
        if (item.status === "COMPLETE") return "completed";
        if (item.status === "CANCELLED") return "expired";
        if (item.status === "SETTLING") return "issues";
        if (item.status === "OPEN") {
            if (item.kind === "fixed") return item.high ? "issues" : "available";
            const awaiting = Boolean(item.awaitingFirstBid || (item.closes === 0 && !item.high));
            if (!awaiting && item.closes > 0 && nowMs >= item.closes) return "issues";
            return "available";
        }
        return "issues";
    };
    section.classList.add("escrow-screen");
    domain.classList.add("escrow-screen");
    const heading = append(section, "h2", "🪙 My POA"), mock = append(section, "p", "", "escrow-mock");
    mock.hidden = true;
    const held = append(section, "p", "POA payments not open", "badge escrow-held");
    held.id = "escrowHeld";
    const content = append(section, "div");
    content.hidden = true;
    append(content, "p", "Your agent signs public requests in your own wallet. Never paste a key or admin password here.", "howto");
    const form = append(content, "div", undefined, "escrow-grid");
    const field = (label, id, placeholder, tag = "input") => { const box = append(form, "label", label); const input = append(box, tag); input.id = id; input.placeholder = placeholder; input.autocomplete = "off"; if (tag === "input")
        input.type = "text"; return input; };
    const payer = field("👤 Your public POA address", "escrowPayer", "poa1…");
    const listingName = field("🏷️ Name I own (for a POA listing)", "escrowName", "👩‍🦰");
    const amount = field("💰 Exact POA amount", "escrowAmount", "1.000000");
    amount.value = "1.000000";
    amount.inputMode = "decimal";
    const summary = append(content, "p", "", "record");
    summary.id = "escrowLimits";
    const actionRow = append(content, "div", undefined, "button-row");
    const message = append(content, "p", "", "escrow-message");
    message.id = "escrowMessage";
    message.setAttribute("role", "status");
    const prompt = append(content, "pre", "", "escrow-copy");
    prompt.id = "escrowPrompt";
    prompt.tabIndex = 0;
    const copyButton = (parent, label, get) => { const b = append(parent, "button", label, "secondary small"); b.type = "button"; b.addEventListener("click", async () => { try {
        await navigator.clipboard.writeText(get());
        message.textContent = "Copied ✅";
    }
    catch {
        message.textContent = "Select the text to copy it.";
    } }); return b; };
    copyButton(content, "📋 Copy prompt for my agent", () => prompt.textContent);
    const signedBox = append(content, "label", "📨 Signed request — public command and signature only");
    const signed = append(signedBox, "textarea");
    signed.id = "escrowSignedPacket";
    signed.rows = 5;
    signed.autocomplete = "off";
    signed.spellcheck = false;
    signed.placeholder = '{"command":{…},"signature":"…"}';
    const send = append(content, "button", "✅ Send signed request");
    send.type = "button";
    send.id = "escrowSubmit";
    const deposit = append(content, "article", undefined, "card escrow-deposit");
    deposit.id = "escrowDeposit";
    deposit.hidden = true;
    const accountBox = append(content, "article", undefined, "card");
    accountBox.id = "escrowAccount";
    const marketBox = append(content, "div");
    marketBox.id = "escrowMarket";
    const request = async (path, packet) => { const r = await fetch(base + path, { method: packet ? "POST" : "GET", credentials: "omit", cache: "no-store", redirect: "error", headers: packet ? { "content-type": "application/json" } : {}, ...(packet ? { body: JSON.stringify(packet) } : {}) }); const b = await r.json(); if (!r.ok) {
        const error = Error(typeof b.code === "string" ? b.code : "POA request held");
        error.uncertain = b.accepted === "unknown";
        throw error;
    } return b; };
    const publicAddress = () => { const a = payer.value.trim(); if (!/^poa1[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
        throw Error("Enter your public poa1 address, not a key"); return a; };
    const prepare = (action, params, extra = "") => { try {
        const actor = publicAddress();
        const command = { domain: "poa-domains.escrow.v1", chainId: "poa-mainnet-1", registryId, actor, key: crypto.randomUUID().replaceAll("-", ""), expires: Math.floor((Date.now() + serverOffset) / 1000) + 1800, action, params };
        prompt.textContent = `${caps.mock ? "MOCK ONLY — never send real POA.\n" : ""}Use my wallet to sign this exact command as canonical sorted-key UTF-8 JSON with Ed25519. Do not reveal or send my private key. Return only {command,signature}, with signature in base58. Verify chain, registry, recipient, amount and live hold state. Do not send POA or approve another amount automatically.\n${JSON.stringify(command, null, 2)}\nSubmit to ${new URL("/v1/escrow/" + (action === "view" ? "account" : action === "intent" ? "intent" : action === "withdraw" ? "withdraw" : "command"), base || location.origin)} using application/json, without any admin credential.\n${extra}`;
        message.textContent = "Copy this prompt to your agent. Check the signed public request before sending it.";
    }
    catch (e) {
        message.textContent = e.message;
    } };
    const btn = (label, action, params, extra) => { const b = append(actionRow, "button", label, "secondary"); b.type = "button"; b.addEventListener("click", () => { try {
        prepare(action, params(), extra);
    }
    catch (e) {
        message.textContent = e.message;
    } }); return b; };
    const fund = btn("➕ Add POA", "intent", () => ({ amount: poaAmount(amount.value) }), "This creates an intent, not a payment. Send from this exact poa1 address only, using the exact recipient, amount and unique memo returned by that intent. After final credit, bid/buy needs a separate signed request.");
    fund.id = "escrowIntentPrompt";
    btn("👀 Read my escrow", "view", () => ({}), "Read only. This signature lets this page refresh only your account until it expires.");
    const fixedList = btn("🏷️ List my name for POA", "list", () => ({ name: listingName.value.trim(), price: poaAmount(amount.value) }), "Only an existing permanent, unencumbered name you own can be listed. Registry-only offers must be cancelled first. Once a buyer pays, escrow pays you on-chain and transfers title automatically — no second handover step required.");
    const auctionOpen = btn("⏱️ Open my POA auction", "open", () => ({ name: listingName.value.trim(), reserve: poaAmount(amount.value) }), "This reserves your title. Once a buyer wins and the auction closes, escrow pays you on-chain and transfers title automatically — no second handover step required.");
    const withdraw = btn("↩️ Request my refund", "withdraw", () => ({ amount: poaAmount(amount.value) }), "Refund only to my original payer address. Do not redirect it. A request is not final until verified on-chain.");
    withdraw.id = "escrowWithdrawPrompt";
    function drawDeposit() {
        const draft = deposit.querySelector("#escrowTxid")?.value;
        deposit.replaceChildren();
        if (!intent) {
            deposit.hidden = true;
            return;
        }
        deposit.hidden = false;
        append(deposit, "h3", `📥 Deposit: ${intent.status}`);
        append(deposit, "p", intent.status === "final" ? "✅ Final and credited. Now sign your bid, purchase or refund request." : intent.status === "seen" ? "👀 Seen. Not credited yet. Ask your agent to retry detect when final." : intent.status === "mismatch" ? `⚠️ Transfer mismatch (${intent.mismatch || "binding"}). Must be sent from ${intent.payer} to ${intent.to} for the exact amount and memo.` : "⏳ Waiting. Send only from the exact address below after checking this intent.");
        for (const [label, value] of [["Send from (must match)", intent.payer], ["To", intent.to], ["Exact amount", intent.amount + " POA"], ["Unique memo", intent.memo]]) {
            append(deposit, "p", label);
            append(deposit, "code", value, "escrow-value");
            copyButton(deposit, "📋 Copy " + label.toLowerCase(), () => value);
        }
        append(deposit, "p", elapsed(intent.finalAt || intent.seenAt || intent.createdAt, Date.now() + serverOffset), "muted");
        const txLabel = append(deposit, "label", "Transaction ID after you send");
        const tx = append(txLabel, "input");
        tx.id = "escrowTxid";
        tx.value = draft || candidate || intent.txid || "";
        tx.autocomplete = "off";
        const detect = append(deposit, "button", "👀 Ask my agent to check this deposit", "secondary");
        detect.type = "button";
        detect.addEventListener("click", () => { if (!/^[0-9a-f]{64}$/.test(tx.value.trim())) {
            message.textContent = "Enter the 64-character transaction ID.";
            return;
        } candidate = tx.value.trim(); prepare("detect", { intent: intent.intent, txid: candidate }, "Verify the exact payer, recipient, amount, memo, signature and finality. Seen is not final credit."); });
    }
    function drawAccount() {
        accountBox.replaceChildren();
        append(accountBox, "h3", "↩️ My escrow & refunds");
        if (!account) {
            append(accountBox, "p", "Ask your agent to sign Read my escrow for your address. No private keys here.");
            return;
        }
        append(accountBox, "p", `Available: ${account.available} POA`);
        append(accountBox, "code", account.payer, "escrow-value");
        for (const d of account.deposits ?? []) {
            append(accountBox, "p", `📥 ${d.amount} POA · ${d.status} · ${elapsed(d.createdAt, Date.now() + serverOffset)}`);
            const track = append(accountBox, "button", "📥 Track deposit " + d.intent.slice(0, 8), "secondary small");
            track.type = "button";
            track.addEventListener("click", async () => { try {
                intent = await request("/v1/escrow/intent?id=" + encodeURIComponent(d.intent));
                candidate = intent.txid;
                drawDeposit();
            }
            catch {
                message.textContent = "Could not read that deposit. No funds moved.";
            } });
        }
        for (const r of account.refunds ?? [])
            append(accountBox, "p", `↩️ ${r.amount} POA · ${r.status === "FINAL" ? "final ✅" : r.status === "READY" ? "queued" : r.status === "SIGNED" ? "prepared; waiting to send" : "checking final status"}`);
    }
    function listing(parent, item, { compact = false } = {}) {
        const nowMs = Date.now() + serverOffset;
        const isAuto = Boolean(item.autoSettle || caps.instantSettlement);
        const bucket = marketBucket(item, nowMs);
        const card = append(parent, "article", undefined, compact ? "card escrow-compact" : "card");
        card.dataset.escrowId = item.id;
        card.dataset.escrowStatus = item.status;
        card.dataset.escrowBucket = bucket;
        card.dataset.escrowKind = item.kind === "fixed" ? "fixed" : "auction";
        card.dataset.escrowAuto = isAuto ? "1" : "0";
        const expanded = !compact || expandedIds.has(item.id);
        if (compact)
            card.dataset.escrowExpanded = expanded ? "1" : "0";
        append(card, "h3", item.name);
        if (compact) {
            const amt = shortPoa(item.high?.amount || item.price);
            const tag = bucket === "completed" ? `✅ ${amt} POA`
                : bucket === "expired" ? `⏰ ${amt} POA`
                    : item.settlement === "TITLE_PENDING" ? "⚠️ Title pending"
                        : item.status === "SETTLING" ? `⏳ Settling · ${amt} POA`
                            : bucket === "issues" ? `⚠️ ${amt} POA`
                                : item.kind === "fixed" ? `💰 ${amt} POA`
                                    : item.high ? `🔥 ${amt} POA` : `🔨 ${amt} POA`;
            append(card, "span", tag, "escrow-row-meta");
        }
        const awaiting = Boolean(item.awaitingFirstBid || (item.closes === 0 && !item.high));
        const actionable = item.status === "OPEN" && (item.kind === "fixed" ? !item.high : (awaiting || !item.closes || nowMs < item.closes));
        if (actionable) {
            const b = append(card, "button", item.kind === "fixed" ? "🛍️ Pay with POA" : "🏷️ Bid with POA", "secondary");
            b.type = "button";
            b.disabled = !!caps.held;
            b.addEventListener("click", () => { selectTab(); amount.value = item.kind === "fixed" ? item.price : amount.value; prepare("intent", { amount: poaAmount(amount.value) }, `For ${item.name}, escrow ${item.kind}, ID ${item.id}. This is funding only. After verified credit, sign ${item.kind === "fixed" ? "buy" : "bid"} with params {auction:"${item.id}",amount:"${poaAmount(amount.value)}"}. ${isAuto ? "Settlement is automatic once purchased or closed (seller + fee paid on-chain before title commits)." : "Check the live price and status again; never assume a transfer or sale completed."}`); });
            const use = append(card, "button", item.kind === "fixed" ? "Use credited POA to buy" : "Use credited POA to bid", "secondary small");
            use.type = "button";
            use.disabled = !!caps.held;
            use.addEventListener("click", () => { selectTab(); if (item.kind === "fixed")
                amount.value = item.price; prepare(item.kind === "fixed" ? "buy" : "bid", { auction: item.id, amount: poaAmount(amount.value) }, isAuto ? "Use only my verified credited funds. Once bought or won at close, escrow pays the seller + fee on-chain and commits title automatically (no second seller handover step)." : "Use only my verified credited funds. Seller must provide separately signed title handover. Purchase reservation is not completion."); });
        }
        const needsManualHandover = (item.status === "OPEN" && item.high && !isAuto) || (item.status === "SETTLING" && item.settlement === "TITLE_PENDING");
        if (needsManualHandover) {
            const finish = append(card, "button", item.settlement === "TITLE_PENDING" ? "🔧 Repair title handover" : "🤝 Ask my agent to finish handover", "secondary small");
            finish.type = "button";
            finish.disabled = !!caps.held;
            finish.addEventListener("click", () => { const cmdAction = item.settlement === "TITLE_PENDING" ? "repair-title" : "settle"; selectTab(); prompt.textContent = `${caps.mock ? "MOCK ONLY — never send real POA.\n" : ""}As seller ${item.seller}, independently verify escrow ${item.id}, name ${item.name}, buyer ${item.high.payer}, amount ${item.high.amount} POA, registry ${registryId}, and live hold/freshness state. Wait until its close time. Read the registry API/capabilities/state and prepare a signed permanent-name transfer to that exact buyer, with the current deed ID/version/nonce, maxTotal and maxNetworkFee zero and a deadline at least 10 minutes ahead. Do not submit that transfer to /v1/intents. Include that public signed packet as params.transfer in a separately payer-signed escrow ${cmdAction} command with params.auction="${item.id}". Use the same domain/chain/registry and canonical Ed25519 format as the other escrow prompts, a new unique key and expiry within 1 hour. Submit only {command,signature} to ${new URL("/v1/escrow/command", base || location.origin)} with application/json and no admin credential. Never reveal keys. Settlement pays the seller/fee before title commit; a reservation is not a completed purchase.`; });
        }
        const body = compact ? append(card, "div", undefined, "escrow-card-details") : card;
        if (compact) {
            body.hidden = !expanded;
            const toggle = append(card, "button", expanded ? "▾" : "▸", "secondary small escrow-expand-btn");
            toggle.type = "button";
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} details for ${item.name}`);
            toggle.title = `${expanded ? "Collapse" : "Expand"} details`;
            const flip = () => {
                const open = !expandedIds.has(item.id);
                if (open) expandedIds.add(item.id);
                else expandedIds.delete(item.id);
                card.dataset.escrowExpanded = open ? "1" : "0";
                body.hidden = !open;
                toggle.textContent = open ? "▾" : "▸";
                toggle.setAttribute("aria-expanded", String(open));
                toggle.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} details for ${item.name}`);
                toggle.title = `${open ? "Collapse" : "Expand"} details`;
            };
            toggle.addEventListener("click", flip);
            card.addEventListener("click", (ev) => {
                if (ev.target?.closest?.("button, input, label, a, [popover]")) return;
                if (body.contains(ev.target)) return;
                flip();
            });
            card.insertBefore(toggle, body);
        }
        append(body, "p", `${item.kind === "fixed" ? "Buy price" : "Reserve"}: ${item.price} POA · ${item.status}`);
        if (item.high)
            append(body, "p", `Highest / reserved: ${item.high.amount} POA`);
        append(body, "p", item.settlement ? `Settlement: ${item.settlement}` : isAuto ? "Automatic settlement: escrow pays seller + fee on-chain and commits title once funded or closed (zero seller handover step)." : "Seller signs handover after funds are held. No title moves before final seller payment.");
        for (const h of item.history ?? [])
            append(body, "p", `${h.event}${h.amount ? " · " + h.amount + " POA" : ""} · ${elapsed(h.at, nowMs)}`, "muted");
    }
    function drawMarket() {
        const nowMs = Date.now() + serverOffset;
        const groups = { available: [], completed: [], expired: [], issues: [] };
        for (const item of market)
            groups[marketBucket(item, nowMs)].push(item);
        marketBox.replaceChildren();
        append(marketBox, "h3", "🏷️ Names listed for POA");
        const tabBar = append(marketBox, "div", undefined, "escrow-market-tabs");
        tabBar.setAttribute("role", "tablist");
        tabBar.setAttribute("aria-label", "POA listing status");
        const tabs = [
            ["available", "🟢 Available", "No available names listed for POA right now."],
            ["completed", "✅ Completed", "No completed POA sales or auctions yet."],
            ["expired", "⏰ Expired", "No expired or cancelled listings."],
            ["issues", "⚠️ Issues", "No listings settling or needing attention."],
        ];
        const tabButtons = [];
        for (const [id, label] of tabs) {
            const count = groups[id].length;
            const t = append(tabBar, "button", `${label} (${count})`, "escrow-market-tab" + (marketTab === id ? " is-active" : ""));
            t.type = "button";
            t.setAttribute("role", "tab");
            t.setAttribute("aria-selected", marketTab === id ? "true" : "false");
            t.tabIndex = marketTab === id ? 0 : -1;
            t.dataset.escrowMarketTab = id;
            t.addEventListener("click", () => { if (marketTab !== id) { marketTab = id; drawMarket(); } });
            tabButtons.push(t);
        }
        tabBar.addEventListener("keydown", (ev) => {
            const idx = tabButtons.indexOf(document.activeElement);
            if (idx < 0) return;
            const next = ev.key === "ArrowRight" ? (idx + 1) % tabButtons.length
                : ev.key === "ArrowLeft" ? (idx - 1 + tabButtons.length) % tabButtons.length
                    : ev.key === "Home" ? 0
                        : ev.key === "End" ? tabButtons.length - 1 : -1;
            if (next < 0) return;
            ev.preventDefault();
            const target = tabButtons[next];
            marketTab = target.dataset.escrowMarketTab;
            drawMarket();
            marketBox.querySelector(`.escrow-market-tab[data-escrow-market-tab="${marketTab}"]`)?.focus();
        });
        const activeItems = groups[marketTab] ?? [];
        const emptyMsg = tabs.find(([id]) => id === marketTab)?.[2] ?? "No names listed for POA.";
        if (!activeItems.length) {
            append(marketBox, "p", emptyMsg, "muted");
            return;
        }
        for (const item of activeItems)
            listing(marketBox, item, { compact: true });
    }
    async function domainView(name) { currentName = name || ""; domain.replaceChildren(); append(domain, "h3", "🪙 POA payments"); if (!caps.enabled) {
        append(domain, "p", "POA payments not open");
        return;
    } if (caps.mock)
        append(domain, "p", "🧪 MOCK CHAIN — test POA only. Never send real funds.", "escrow-mock"); if (!currentName)
        return; append(domain, "p", caps.held ? "⏸️ " + caps.holdReason : "Custodial payments · node-trusted finality"); try {
        const v = await request("/v1/escrow/domain?name=" + encodeURIComponent(currentName));
        if (!v.items.length)
            append(domain, "p", "This name is not listed for POA payments.");
        for (const item of v.items)
            listing(domain, item);
    }
    catch {
        append(domain, "p", "POA payments held. Try refreshing.");
    } }
    async function refresh() {
        if (stopped || busy || !capability?.enabled)
            return;
        busy = true;
        try {
            caps = await request("/v1/escrow/capabilities");
            if (caps.serverTime)
                serverOffset = caps.serverTime - Date.now();
            content.hidden = !caps.enabled;
            held.textContent = caps.enabled ? (caps.held ? "⏸️ " + caps.holdReason : "🟢 POA payments open") : "POA payments not open";
            mock.hidden = !caps.mock;
            mock.textContent = caps.mock ? "🧪 MOCK CHAIN — test POA only. Never send real funds." : "";
            for (const b of [fund, withdraw, fixedList, auctionOpen])
                b.disabled = !!caps.held;
            if (!caps.enabled) {
                await domainView(currentName);
                return;
            }
            summary.textContent = `Escrow: ${caps.address} · Per payment ${caps.limits.perTransaction} POA · Per day ${caps.limits.daily} POA`;
            const v = await request("/v1/escrow/market");
            market = v.items;
            drawMarket();
            if (currentName)
                await domainView(currentName);
            if (intent) {
                intent = await request("/v1/escrow/intent?id=" + encodeURIComponent(intent.intent) + (candidate ? "&txid=" + encodeURIComponent(candidate) : ""));
                drawDeposit();
            }
            if (viewPacket && viewPacket.command.expires <= Math.floor((Date.now() + serverOffset) / 1000)) {
                viewPacket = null;
                account = null;
                drawAccount();
                append(accountBox, "p", "Read signature expired. Ask your agent to sign Read my escrow again.");
            }
            if (viewPacket && viewPacket.command.expires > Math.floor((Date.now() + serverOffset) / 1000)) {
                account = (await request("/v1/escrow/account", viewPacket)).account;
                drawAccount();
            }
        }
        catch {
            held.textContent = "⏸️ POA payments held. Could not check freshness.";
            caps.held = true;
            fund.disabled = withdraw.disabled = fixedList.disabled = auctionOpen.disabled = true;
            for (const b of [...marketBox.querySelectorAll("button:not(.escrow-market-tab):not(.escrow-expand-btn):not(.inline-info):not(.info-close)"), ...domain.querySelectorAll("button:not(.inline-info):not(.info-close)")])
                b.disabled = true;
        }
        finally {
            busy = false;
        }
    }
    send.addEventListener("click", async () => {
        let packet;
        try {
            packet = JSON.parse(signed.value);
            if (!packet || Object.keys(packet).sort().join(",") !== "command,signature" || typeof packet.signature !== "string" || typeof packet.command !== "object" || packet.command.actor !== publicAddress())
                throw Error("Use a signed public request for your address only. Never paste a key.");
            const a = packet.command.action;
            const endpoint = a === "view" ? "account" : a === "intent" ? "intent" : a === "withdraw" ? "withdraw" : "command";
            if (a === "detect")
                candidate = packet.command.params.txid;
            const result = await request("/v1/escrow/" + endpoint, packet);
            signed.value = "";
            if (result.account) {
                account = result.account;
                drawAccount();
            }
            if (a === "view")
                viewPacket = packet;
            if (a === "intent") {
                intent = { ...result.result, payer: packet.command.actor, amount: packet.command.params.amount, status: "waiting" };
                candidate = null;
                drawDeposit();
            }
            message.textContent = a === "withdraw" ? "Refund requested. Watch for verified final status." : "Signed request accepted ✅";
            await refresh();
        }
        catch (e) {
            if (!e.uncertain)
                signed.value = "";
            message.textContent = e.uncertain ? "Outcome unknown. Keep and retry only this exact signed request, or ask your agent to read your account. Do not create a new request key or payment." : e.message === "ESCROW_NOT_FINAL" ? "👀 Seen is not final credit. Keep the same intent and ask your agent to check again." : e.message;
            if (intent && candidate)
                await refresh();
        }
    });
    payer.addEventListener("change", () => { const next = payer.value.trim(); if (account && account.payer !== next) {
        account = null;
        viewPacket = null;
        drawAccount();
    } if (intent && intent.payer !== next) {
        intent = null;
        candidate = null;
        drawDeposit();
    } });
    drawAccount();
    const timer = setInterval(refresh, 5000);
    refresh();
    domainView("");
    return { domain: domainView, stop() { stopped = true; clearInterval(timer); }, refresh };
}
