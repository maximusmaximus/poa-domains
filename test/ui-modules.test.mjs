import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';
import {buildCartItem,editCartAmount,isPoaAddress,resolveDefaultAuctionTab,shortenPoaAddress} from '../reference-web/shared.js';
import {capabilities} from '../dist/src/interface.js';
import {profileEngine} from './fixtures/ui-harness.mjs';
import {auctionState,offerState} from './fixtures/ui-state.mjs';
import {stampAssets} from '../scripts/stamp-assets.mjs';

test('one cart factory derives root, bid, resale and child params from current capabilities/state',()=>{
 for(const profile of ['fixture','mainnet']) {
  const e=profileEngine(profile),cap=capabilities(e),state=e.snapshot();
  for(const name of ['alpha','🚀','🚀🚀']){
   const item=buildCartItem({name,action:'announceAuction+bid'},cap,state);
   assert.equal(item.params.reserve,cap.assets.POA[item.tier==='premium'?'premiumReserve':'standardReserve']);
   assert.equal(item.params.maxBid,item.amount);assert.equal(item.needsReview,false);
   const edited=editCartAmount(item,(BigInt(item.amount)*2n).toString(),cap,state);
   assert.equal(edited.params.reserve,item.params.reserve);assert.equal(edited.params.maxBid,edited.amount);
  }
 }
 const cap=capabilities(profileEngine()),auctions=auctionState(),a=Object.values(auctions.auctions)[0];
 const bid=buildCartItem({name:'alpha',action:'bid',auctionId:a.id},cap,auctions);
 assert.deepEqual(bid.params,{auctionId:a.id,expectedVersion:a.version,asset:'POA',amount:'1101'});
 assert.equal(bid.needsReview,false);
 const resale=offerState(),o=Object.values(resale.offers)[0];
 const buy=buildCartItem({name:'alpha',action:'buyFixed',offerId:o.id},cap,resale);
 assert.deepEqual(buy.params,{offerId:o.id,expectedVersion:o.version,asset:'POA',amount:o.price});assert.equal(buy.needsReview,false);
 o.kind='child';o.labels=['shop'];resale.names['shop.alpha']={generation:2,activeId:null,auctionId:null};
 const child=buildCartItem({name:'shop.alpha',action:'fillChildOffer',offerId:o.id},cap,resale);
 assert.equal(child.params.expectedGeneration,3);assert.equal(child.params.label,'shop');assert.equal(child.params.metadata.document.name,'shop.alpha');assert.equal(child.needsReview,false);
 assert.throws(()=>buildCartItem({name:'alpha',action:'bid',auctionId:'missing'},cap,auctions),/current auction/);
 assert.throws(()=>buildCartItem({name:'alpha',action:'buyFixed',offerId:'missing'},cap,resale),/current offer/);
});

test('UI responsibilities are separate modules, callers cannot duplicate cart params, and graph stamps are stable',()=>{
 const modules=readdirSync('reference-web').filter(n=>n.startsWith('ui-')&&n.endsWith('.js'));
 for(const part of ['router','render','cart','poll','handoff','state'])assert.ok(modules.includes(`ui-${part}.js`));
 const bootstrap=readFileSync('reference-web/app.js','utf8');assert.ok(bootstrap.split('\n').length<250);
 for(const file of modules.filter(n=>n!=='ui-state.js')) {
  const source=readFileSync('reference-web/'+file,'utf8');
  assert.doesNotMatch(source,/addToCart\(\{[^}]*\bparams\s*:/s,file);
  for(const [,target,revision]of source.matchAll(/from\s*["']\.\/([a-z-]+\.js)\?v=([a-f0-9]{12})["']/g)) {
   assert.ok(readdirSync('reference-web').includes(target));
   assert.ok(readFileSync('reference-web/index.html','utf8').includes(`/app.js?v=${revision}`));
  }
 }
 assert.equal(stampAssets().changed,false,'a second stamp must not alter files or cycle hashes');
});

test('escrow unminification preserves the exact reviewed executable program',()=>{
 const source=readFileSync('reference-web/escrow.js','utf8').replace(/\?v=[0-9a-f]{12}/g,'');
 const code=transformSync(source,{loader:'js',minify:true,legalComments:'none'}).code;
 assert.equal(createHash('sha256').update(code).digest('hex'),readFileSync('test/fixtures/escrow-executable.sha256','utf8').trim());
});

test('all UI modules load without booting a browser, and shared copy guards remain fail closed',async()=>{
 const revision=/app\.js\?v=([a-f0-9]{12})/.exec(readFileSync('reference-web/index.html','utf8'))[1];
 const modules={};for(const file of readdirSync('reference-web').filter(n=>n.startsWith('ui-')&&n.endsWith('.js')))modules[file]=await import(`../reference-web/${file}?v=${revision}`);
 const {ui}=modules['ui-state.js'],cart=modules['ui-cart.js'],core=modules['ui-core.js'];
 const previous={...ui};
 try {
  assert.equal(cart.cartCopyBlocked(),true);
  Object.assign(ui,{refreshing:false,lastLoadedAt:1000000,registryReadFailed:false,cart:[],networkStatus:{level:'online',hold:false}});
  assert.equal(cart.cartCopyBlocked(),false);
  for(const item of [{validationError:'invalid'},{needsReview:true}]){ui.cart=[item];assert.equal(cart.cartCopyBlocked(),true);}
  ui.cart=[];ui.networkStatus.hold=true;assert.equal(cart.cartCopyBlocked(),true);
  assert.match(core.statusLabel('available'),/🟢/);assert.equal(core.statusLabel('owned'),'Owned');assert.equal(core.statusLabel('custom'),'custom');
  ui.details={roles:{buyer:'fixture-public-id'}};assert.equal(core.person('fixture-public-id'),'Demo buyer');assert.match(core.person('other-public-identity'),/…$/);
  const samplePoa='poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf';
  assert.equal(isPoaAddress(samplePoa),true);
  assert.equal(isPoaAddress('poa1...piRf'),false);
  assert.equal(isPoaAddress('other-public-identity'),false);
  assert.equal(shortenPoaAddress(samplePoa),'poa1...piRf');
  assert.equal(core.person(samplePoa),'poa1...piRf');
  ui.demo=true;assert.equal(core.endpointBase(),'http://127.0.0.1:8787');ui.demo=false;ui.base='https://poadomains.grok.me';assert.equal(core.endpointBase(),ui.base);
 }finally{Object.assign(ui,previous);}
});

test('copyText tries Clipboard API, falls back to execCommand inside dialog/body, and falls back to text selection', async () => {
 const revision = /app\.js\?v=([a-f0-9]{12})/.exec(readFileSync('reference-web/index.html', 'utf8'))[1];
 const copyMod = await import(`../reference-web/ui-copy.js?v=${revision}`);
 const cartMod = await import(`../reference-web/ui-cart.js?v=${revision}`);
 const stateMod = await import(`../reference-web/ui-state.js?v=${revision}`);
 const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const prevDoc = globalThis.document, prevWin = globalThis.window;
 const setNav = (val) => Object.defineProperty(globalThis, 'navigator', { value: val, configurable: true });
 try {
  assert.deepEqual(await copyMod.copyText(''), { ok: false, method: 'empty', selected: false });
  setNav({ clipboard: { writeText: async (v) => { assert.equal(v, 'hello'); } } });
  assert.deepEqual(await copyMod.copyText('hello'), { ok: true, method: 'clipboard', selected: false });

  // Clipboard rejects -> execCommand inside dialog container succeeds and restores focus
  let appendedTo = null, focusedBack = 0, execCalls = 0;
  const dialog = { nodeName: 'DIALOG' };
  const btn = { isConnected: true, focus: () => { focusedBack++; }, closest: () => dialog };
  dialog.append = (node) => { appendedTo = node; };
  globalThis.document = {
   activeElement: btn,
   body: { append: () => { throw Error('should prefer dialog'); } },
   createElement: () => ({
    style: {},
    setAttribute: () => {},
    focus: () => {},
    select: () => {},
    setSelectionRange: () => {},
    remove: () => {},
   }),
   execCommand: (cmd) => { execCalls++; return cmd === 'copy'; },
   createRange: () => ({ selectNodeContents: () => {} }),
  };
  setNav({ clipboard: { writeText: async () => { throw Error('denied'); } } });
  assert.deepEqual(await copyMod.copyText('poa prompt'), { ok: true, method: 'execCommand', selected: false });
  assert.equal(execCalls, 1);
  assert.ok(appendedTo);
  assert.equal(focusedBack, 1);

  // Navigator.clipboard undefined + execCommand false -> manual select fallback
  setNav({});
  let selectedNode = null;
  globalThis.document.execCommand = () => false;
  globalThis.window = {
   getSelection: () => ({ removeAllRanges: () => {}, addRange: (r) => { selectedNode = r; } }),
  };
  const node = { textContent: 'manual' };
  assert.deepEqual(await copyMod.copyText('manual', node), { ok: false, method: 'manual', selected: true });
  assert.ok(selectedNode);

  // flashCopied updates and restores label cleanly
  const flashBtn = { textContent: '📋', title: 'Copy prompt', dataset: {} };
  copyMod.flashCopied(flashBtn);
  assert.equal(flashBtn.textContent, '✅');
  assert.equal(flashBtn.title, 'Copied');
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(flashBtn.textContent, '📋');
  assert.equal(flashBtn.title, 'Copy prompt');

  // renderCurrentCartHandoff handles both poaOnly and standard v2 cart handoff payloads
  const prevUi = { ...stateMod.ui };
  try {
   const { auditedEngine, get } = await import('./fixtures/audited-engine.mjs');
   const eng = auditedEngine();
   const poaCap = get(eng, '/v1/capabilities').data;
   const snap = get(eng, '/v1/state').data;
   const { buildPoaCheckoutHandoff } = await import(`../reference-web/agent-cart.js?v=${revision}`);
   stateMod.ui.cap = poaCap;
   stateMod.ui.handoffData = buildPoaCheckoutHandoff(
    [{ name: 'freshpoaname', action: 'poaCheckout', amount: '100.000000', tier: 'standard' }],
    poaCap,
    'https://poadomains.grok.me',
    snap,
    1000000,
   );
   assert.match(cartMod.renderCurrentCartHandoff(), /poa-domains\.poa-checkout\.v1/);
   stateMod.ui.cap = { poaOnly: { status: 'off' } };
   stateMod.ui.handoffData = {
    schema: 'poa-domains.agent-cart.v2',
    generatedAt: 1000000,
    itemCount: 0,
    spendingCapByAsset: { POA: '0' },
    mcp: { url: 'https://example.invalid/mcp', transport: 'streamable-http' },
    cli: { prepare: 'poa prepare', submit: 'poa submit' },
    byAction: {},
    items: [],
    instructions: ['No items'],
   };
   assert.match(cartMod.renderCurrentCartHandoff(), /poa-domains\.agent-cart\.v2/);
   stateMod.ui.handoffData = null;
   assert.equal(cartMod.renderCurrentCartHandoff(), '');
  } finally {
   Object.assign(stateMod.ui, prevUi);
  }
 } finally {
  if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
  globalThis.document = prevDoc;
  globalThis.window = prevWin;
 }
});

test('router domain avatars, escrow payer autofill, management plans, and address copy helpers work in isolation', async () => {
 const revision = /app\.js\?v=([a-f0-9]{12})/.exec(readFileSync('reference-web/index.html', 'utf8'))[1];
 const routerMod = await import(`../reference-web/ui-router.js?v=${revision}`);
 const manageMod = await import(`../reference-web/ui-manage.js?v=${revision}`);
 const copyMod = await import(`../reference-web/ui-copy.js?v=${revision}`);
 const coreMod = await import(`../reference-web/ui-core.js?v=${revision}`);
 const { ui } = await import(`../reference-web/ui-state.js?v=${revision}`);
 const prevUi = { ...ui };
 const prevDoc = globalThis.document;
 const prevStorage = globalThis.localStorage;
 const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const store = new Map();
 const makeEl = (tag) => {
  const listeners = new Map();
  const attrs = new Map();
  const classes = new Set();
  const node = {
   tagName: tag.toUpperCase(),
   children: [],
   dataset: {},
   textContent: '',
   value: '',
   title: '',
   href: '',
   src: '',
   alt: '',
   type: '',
   get className() { return [...classes].join(' '); },
   set className(v) { classes.clear(); for (const c of String(v || '').split(/\s+/).filter(Boolean)) classes.add(c); },
   classList: {
    add: (...xs) => xs.forEach((x) => classes.add(x)),
    remove: (...xs) => xs.forEach((x) => classes.delete(x)),
    contains: (x) => classes.has(x),
    toggle: (x, on) => { if (on === undefined ? !classes.has(x) : on) classes.add(x); else classes.delete(x); },
   },
   setAttribute: (k, v) => attrs.set(k, String(v)),
   getAttribute: (k) => attrs.get(k) ?? null,
   removeAttribute: (k) => attrs.delete(k),
   hasAttribute: (k) => attrs.has(k),
   focus: () => { node.focused = true; },
   scrollIntoView: () => { node.scrolled = true; },
   querySelector: () => null,
   append: (...xs) => { node.children.push(...xs); },
   replaceChildren: (...xs) => { node.children = [...xs]; },
   remove: () => { node.removed = true; },
   addEventListener: (ev, fn) => { listeners.set(ev, [...(listeners.get(ev) ?? []), fn]); },
   dispatchEvent: (ev) => { for (const fn of listeners.get(ev.type) ?? []) fn(ev); return true; },
   _listeners: listeners,
  };
  return node;
 };
 try {
  const byId = new Map();
  const payerEl = makeEl('input');
  const manageOwnerEl = makeEl('input');
  byId.set('escrowPayer', payerEl);
  byId.set('manageOwner', manageOwnerEl);
  globalThis.document = {
   getElementById: (id) => byId.get(id) ?? null,
   createElement: (tag) => makeEl(tag),
   createElementNS: (_ns, tag) => makeEl(tag),
  };
  globalThis.localStorage = {
   getItem: (k) => (store.has(k) ? store.get(k) : null),
   setItem: (k, v) => store.set(k, String(v)),
   removeItem: (k) => store.delete(k),
  };
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
   value: { clipboard: { writeText: async (v) => copied.push(v) } },
   configurable: true,
  });

  const ownerA = 'poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf';
  const ownerB = 'poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N';
  const avatarCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

  ui.knownOwner = ownerA;
  ui.inferredCartOwner = '';
  ui.bidderAddress = '';
  let changes = 0;
  payerEl.addEventListener('change', () => changes++);
  assert.equal(routerMod.resolveKnownPoaAddress(), ownerA);
  assert.equal(routerMod.syncEscrowPayerAddress(), ownerA);
  assert.equal(payerEl.value, ownerA);
  assert.equal(changes, 1);
  payerEl.value = ownerB;
  assert.equal(routerMod.syncEscrowPayerAddress(ownerA), ownerA);
  assert.equal(payerEl.value, ownerB);
  assert.equal(routerMod.syncEscrowPayerAddress(ownerA, { force: true }), ownerA);
  assert.equal(payerEl.value, ownerA);
  assert.equal(changes, 2);

  const deedId = 'a'.repeat(64);
  const childId = 'b'.repeat(64);
  const extDeedId = 'c'.repeat(64);
  ui.latestState = {
   time: 1000,
   names: {
    agent: { name: 'agent', activeId: deedId },
    'sub.agent': { name: 'sub.agent', activeId: childId },
    moon: { name: 'moon', activeId: extDeedId },
   },
   deeds: {
    [deedId]: {
     id: deedId, name: 'agent', parentId: null, owner: ownerA, version: 2, ownerVersion: 1, retired: false,
     rights: { kind: 'permanent' }, rightsHash: 'f'.repeat(64), records: [],
     metadata: [{ cid: avatarCid, document: { schema: 'poa-domains.profile.v1', version: 1, name: 'agent', rightsHash: 'f'.repeat(64), poa: ownerA, btc: null, eth: null, description: 'bio', image: `ipfs://${avatarCid}` } }],
    },
    [childId]: {
     id: childId, name: 'sub.agent', parentId: deedId, owner: ownerB, version: 1, ownerVersion: 1, retired: false,
     rights: { kind: 'permanent' }, rightsHash: 'e'.repeat(64), records: [], metadata: [],
    },
    [extDeedId]: {
     id: extDeedId, name: 'moon', parentId: null, owner: ownerB, version: 2, ownerVersion: 1, retired: false,
     rights: { kind: 'permanent' }, rightsHash: 'd'.repeat(64), records: [],
     metadata: [{ cid: avatarCid, document: { schema: 'poa-domains.profile.v1', version: 1, name: 'moon', rightsHash: 'd'.repeat(64), poa: ownerB, btc: null, eth: null, description: 'moon', image: 'https://pub.r2.dev/moon.png' } }],
    },
   },
   offers: {},
   auctions: {},
  };
  ui.escrowMarket = [];
  assert.equal(routerMod.isRegisteredDomain('agent'), true);
  assert.equal(routerMod.isRegisteredDomain('unregistered'), false);
  assert.equal(routerMod.domainAvatarMediaPath('agent'), `/v1/media/${avatarCid}`);
  assert.equal(routerMod.domainAvatarMediaPath('moon'), '/v1/media/domain/moon');
  assert.equal(routerMod.domainAvatarMediaPath('sub.agent'), null);
  assert.equal(routerMod.domainAvatarMediaPath('unregistered'), null);

  ui.escrowMarket = [{ id: '1'.repeat(64), name: 'agent', kind: 'auction', status: 'OPEN', price: '100.000000', closes: 0, awaitingFirstBid: true }];
  assert.equal(routerMod.domainAvatarMediaPath('agent'), null);
  ui.escrowMarket = [];

  const h = makeEl('h2');
  const { avatar, link } = routerMod.domainHeader(h, 'agent', { size: 'lg', prefix: 'Name: ', suffix: '!' });
  assert.equal(h.classList.contains('domain-heading'), true);
  assert.equal(avatar.classList.contains('domain-header-avatar-lg'), true);
  assert.equal(avatar.classList.contains('has-image'), true);
  assert.equal(link.classList.contains('domain-tile'), true);
  const imgNode = avatar.children.find((c) => c.tagName === 'IMG');
  assert.equal(imgNode.src, `/v1/media/${avatarCid}`);
  imgNode.dispatchEvent({ type: 'error' });
  assert.equal(avatar.classList.contains('has-image'), false);
  assert.equal(imgNode.removed, true);
  const emojiAvatar = routerMod.createDomainAvatar('🚀', { size: 'sm' });
  assert.equal(emojiAvatar.children[0].classList.contains('domain-name'), true);
  assert.equal(emojiAvatar.children[0].textContent, '🚀');

  assert.equal(manageMod.managedNames(ui.latestState, ownerA).length, 1);
  const childOffer = manageMod.managementPlan('createChildOffer', ui.latestState.deeds[deedId], ui.latestState, ownerA, '50', '24');
  assert.equal(childOffer.action, 'createChildOffer');
  assert.equal(childOffer.params.validUntil, 1000 + 24 * 3600);
  const fixedPlan = manageMod.managementPlan('sellFixed', ui.latestState.deeds[deedId], ui.latestState, ownerA, '200', '48');
  assert.equal(fixedPlan.params.price, '200');
  const revokePlan = manageMod.managementPlan('revokeChild', ui.latestState.deeds[childId], ui.latestState, ownerB, '100', '24');
  assert.deepEqual(revokePlan.coSigners, [ownerA]);
  assert.throws(() => manageMod.managementPlan('sellFixed', ui.latestState.deeds[deedId], ui.latestState, ownerB), /not the active registry holder/);
  assert.throws(() => manageMod.managementPlan('sellFixed', ui.latestState.deeds[deedId], ui.latestState, ownerA, '0'), /whole-number/);
  assert.throws(() => manageMod.managementPlan('createChildOffer', ui.latestState.deeds[childId], ui.latestState, ownerB), /Only a root/);
  assert.throws(() => manageMod.managementPlan('revokeChild', ui.latestState.deeds[deedId], ui.latestState, ownerA), /Only a subdomain/);
  assert.throws(() => manageMod.managementPlan('unknown', ui.latestState.deeds[deedId], ui.latestState, ownerA), /Unsupported/);

  const prevLoc = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const prevHist = Object.getOwnPropertyDescriptor(globalThis, 'history');
  const pushedUrls = [];
  Object.defineProperty(globalThis, 'location', { value: { pathname: '/d/agent', search: '' }, configurable: true });
  Object.defineProperty(globalThis, 'history', { value: { pushState: (_s, _t, u) => pushedUrls.push(u) }, configurable: true });
  const homeMain = makeEl('main'), domainMain = makeEl('main'), ownerMain = makeEl('main');
  const sectionTabsEl = makeEl('nav');
  const tabFindEl = makeEl('button'), tabEscrowEl = makeEl('button');
  tabFindEl.setAttribute('data-tab', 'find');
  tabEscrowEl.setAttribute('data-tab', 'escrow');
  const searchSecEl = makeEl('section'), handoffSecEl = makeEl('section');
  searchSecEl.setAttribute('data-section', 'find');
  handoffSecEl.setAttribute('data-section', 'handoff');
  const advLinkEl = makeEl('a');
  byId.set('homeMain', homeMain);
  byId.set('domainMain', domainMain);
  byId.set('ownerMain', ownerMain);
  byId.set('sectionTabs', sectionTabsEl);
  byId.set('handoffSection', handoffSecEl);
  byId.set('advancedLink', advLinkEl);
  globalThis.document.querySelectorAll = (sel) => {
   if (sel === '.section-tab') return [tabFindEl, tabEscrowEl];
   if (sel === 'main#homeMain > section[data-section]') return [searchSecEl, handoffSecEl];
   return [];
  };
  ui.route = { kind: 'domain', name: 'agent' };
  ui.lastSearch = '';
  routerMod.openAdvanced();
  assert.equal(ui.route.kind, 'home');
  assert.equal(ui.activeSectionTab, 'handoff');
  assert.equal(homeMain.hidden, false);
  assert.equal(domainMain.hidden, true);
  assert.equal(handoffSecEl.hidden, false);
  assert.equal(searchSecEl.hidden, true);
  assert.equal(tabFindEl.tabIndex, 0);
  assert.equal(tabEscrowEl.tabIndex, -1);
  assert.equal(advLinkEl.getAttribute('aria-current'), 'page');
  assert.equal(advLinkEl.classList.contains('is-active'), true);
  assert.equal(handoffSecEl.focused, true);
  assert.equal(pushedUrls.at(-1), '/?tab=handoff');
  routerMod.setSectionTab('find', false);
  assert.equal(advLinkEl.getAttribute('aria-current'), null);
  assert.equal(advLinkEl.classList.contains('is-active'), false);
  if (prevLoc) Object.defineProperty(globalThis, 'location', prevLoc); else delete globalThis.location;
  if (prevHist) Object.defineProperty(globalThis, 'history', prevHist); else delete globalThis.history;

  const wrapParent = makeEl('p');
  coreMod.appendPoaAddress(wrapParent, ownerA, { code: true });
  coreMod.appendPoaAddress(wrapParent, 'not-a-poa', { code: true });
  coreMod.appendPoaAddress(wrapParent, 'plain-text');
  coreMod.appendPrincipal(wrapParent, ownerB);
  const copyBtn = copyMod.createPoaCopyButton(ownerA);
  await copyBtn._listeners.get('click')[0]({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(copied, [ownerA]);
  assert.equal(copyBtn.classList.contains('is-copied'), true);
  assert.equal(copyMod.createCopyIconSvg(true).children.length, 1);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(copyBtn.classList.contains('is-copied'), false);
 } finally {
  Object.assign(ui, prevUi);
  globalThis.document = prevDoc;
  globalThis.localStorage = prevStorage;
  if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
 }
});

test('resolveDefaultAuctionTab defaults to upcoming when current is empty and respects user choice', async () => {
 assert.equal(resolveDefaultAuctionTab(), 'current');
 assert.equal(resolveDefaultAuctionTab({ current: [], upcoming: [] }), 'current');
 assert.equal(resolveDefaultAuctionTab({ current: [], upcoming: [{ id: '1' }] }), 'upcoming');
 assert.equal(resolveDefaultAuctionTab({ current: [{ id: '1' }], upcoming: [{ id: '2' }] }), 'current');
 assert.equal(resolveDefaultAuctionTab({ current: [], upcoming: [{ id: '1' }] }, { currentTab: 'current', userSelected: true }), 'current');
 assert.equal(resolveDefaultAuctionTab({ current: [], upcoming: [{ id: '1' }] }, { currentTab: 'past', userSelected: true }), 'past');
 assert.equal(resolveDefaultAuctionTab({ current: [{ id: '1' }], upcoming: [{ id: '2' }] }, { currentTab: 'upcoming', userSelected: false, keepActiveTab: true }), 'upcoming');
 assert.equal(resolveDefaultAuctionTab({ current: [{ id: '1' }], upcoming: [{ id: '2' }] }, { currentTab: 'upcoming', userSelected: false, keepActiveTab: false }), 'current');

 const revision = /app\.js\?v=([a-f0-9]{12})/.exec(readFileSync('reference-web/index.html', 'utf8'))[1];
 const { ui } = await import(`../reference-web/ui-state.js?v=${revision}`);
 const renderMod = await import(`../reference-web/ui-render.js?v=${revision}`);
 const prevUi = { ...ui };
 const prevDoc = globalThis.document;
 try {
  const makeTab = (id, key) => {
   const attrs = new Map([['data-auction-tab', key]]);
   const classes = new Set();
   return {
    id,
    tabIndex: -1,
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    classList: {
     toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
     contains: (c) => classes.has(c),
    },
   };
  };
  const tCur = makeTab('auctionTabCurrent', 'current');
  const tUp = makeTab('auctionTabUpcoming', 'upcoming');
  const tPast = makeTab('auctionTabPast', 'past');
  const panelAttrs = new Map();
  const panel = {
   setAttribute: (k, v) => panelAttrs.set(k, String(v)),
   getAttribute: (k) => panelAttrs.get(k) ?? null,
  };
  globalThis.document = {
   getElementById: (id) => (id === 'auctions' ? panel : null),
   querySelectorAll: (sel) => (sel === '.auction-tab' ? [tCur, tUp, tPast] : []),
  };
  ui.auctionTab = 'current';
  ui.auctionTabChosen = false;
  ui.latestState = null;

  renderMod.setAuctionTab('upcoming');
  assert.equal(ui.auctionTab, 'upcoming');
  assert.equal(ui.auctionTabChosen, false);
  assert.equal(tUp.classList.contains('is-active'), true);
  assert.equal(tUp.getAttribute('aria-selected'), 'true');
  assert.equal(tUp.tabIndex, 0);
  assert.equal(tCur.tabIndex, -1);
  assert.equal(panel.getAttribute('aria-labelledby'), 'auctionTabUpcoming');

  renderMod.setAuctionTab('past', { user: true });
  assert.equal(ui.auctionTab, 'past');
  assert.equal(ui.auctionTabChosen, true);
  assert.equal(tPast.tabIndex, 0);
  assert.equal(panel.getAttribute('aria-labelledby'), 'auctionTabPast');

  renderMod.setAuctionTab('unknown', { render: true });
  assert.equal(ui.auctionTab, 'current');
  assert.equal(tCur.tabIndex, 0);
  assert.equal(panel.getAttribute('aria-labelledby'), 'auctionTabCurrent');
 } finally {
  Object.assign(ui, prevUi);
  globalThis.document = prevDoc;
 }
});

test('owner profile, domain page, ownerLink primary rendering, and Manage main-domain + transfer flows work in Node DOM', async () => {
 const revision = /app\.js\?v=([a-f0-9]{12})/.exec(readFileSync('reference-web/index.html', 'utf8'))[1];
 const { ui } = await import(`../reference-web/ui-state.js?v=${revision}`);
 const routerMod = await import(`../reference-web/ui-router.js?v=${revision}`);
 const domainMod = await import(`../reference-web/ui-domain.js?v=${revision}`);
 const manageMod = await import(`../reference-web/ui-manage.js?v=${revision}`);
 const renderMod = await import(`../reference-web/ui-render.js?v=${revision}`);

 const prevUi = { ...ui };
 const prevDoc = globalThis.document;
 const prevLoc = Object.getOwnPropertyDescriptor(globalThis, 'location');
 const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
 const prevStorage = globalThis.localStorage;

 const allNodes = [];
 const byId = new Map();
 const makeNode = (tag) => {
  const classes = new Set();
  const attrs = new Map();
  const listeners = new Map();
  const node = {
   tagName: String(tag).toUpperCase(),
   _id: '',
   get id() { return node._id; },
   set id(v) { node._id = String(v); if (v) byId.set(node._id, node); },
   value: '',
   textContent: '',
   hidden: false,
   disabled: false,
   open: false,
   type: '',
   placeholder: '',
   title: '',
   href: '',
   src: '',
   alt: '',
   dataset: {},
   children: [],
   parentNode: null,
   get className() { return [...classes].join(' '); },
   set className(v) { classes.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c); },
   classList: {
    add: (...cs) => cs.forEach((c) => classes.add(c)),
    remove: (...cs) => cs.forEach((c) => classes.delete(c)),
    toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
    contains: (c) => classes.has(c),
   },
   setAttribute: (k, v) => attrs.set(k, String(v)),
   getAttribute: (k) => attrs.get(k) ?? null,
   removeAttribute: (k) => attrs.delete(k),
   hasAttribute: (k) => attrs.has(k),
   focus: () => { node.focused = true; },
   scrollIntoView: () => {},
   closest: () => null,
   contains: () => false,
   querySelector: (sel) => node.querySelectorAll(sel)[0] ?? null,
   querySelectorAll: (sel) => {
    const out = [];
    const walk = (n) => {
     for (const ch of n.children ?? []) {
      if (!ch || typeof ch !== 'object') continue;
      if (
       (sel === 'article.card' && ch.tagName === 'ARTICLE' && ch.classList.contains('card')) ||
       (sel.startsWith('#') && ch.id === sel.slice(1))
      ) out.push(ch);
      walk(ch);
     }
    };
    walk(node);
    return out;
   },
   append: (...xs) => {
    for (const x of xs) {
     if (x && typeof x === 'object') x.parentNode = node;
     node.children.push(x);
    }
   },
   replaceChildren: (...xs) => {
    node.children = [];
    node.append(...xs);
   },
   remove: () => { node.removed = true; },
   addEventListener: (ev, fn) => { listeners.set(ev, [...(listeners.get(ev) ?? []), fn]); },
   dispatchEvent: (ev) => { for (const fn of listeners.get(ev.type) ?? []) fn(ev); return true; },
   click: async () => { for (const fn of listeners.get('click') ?? []) await fn({ preventDefault() {}, stopPropagation() {}, target: node }); },
   _listeners: listeners,
  };
  allNodes.push(node);
  return node;
 };
 const findAll = (root, pred, out = []) => {
  for (const ch of root.children ?? []) {
   if (!ch || typeof ch !== 'object') continue;
   if (pred(ch)) out.push(ch);
   findAll(ch, pred, out);
  }
  return out;
 };
 const collectText = (root) => {
  if (typeof root === 'string') return root;
  if (!root || typeof root !== 'object') return '';
  return [root.textContent, ...(root.children ?? []).map(collectText)].filter(Boolean).join(' ');
 };

 try {
  const copied = [];
  const store = new Map();
  globalThis.localStorage = {
   getItem: (k) => (store.has(k) ? store.get(k) : null),
   setItem: (k, v) => store.set(k, String(v)),
   removeItem: (k) => store.delete(k),
  };
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://poadomains.grok.me', pathname: '/', search: '' }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (v) => copied.push(v) } }, configurable: true });
  globalThis.document = {
   activeElement: null,
   body: makeNode('body'),
   getElementById: (id) => byId.get(id) ?? null,
   createElement: (tag) => makeNode(tag),
   createElementNS: (_ns, tag) => makeNode(tag),
   querySelectorAll: () => [],
  };

  for (const id of [
   'ownerTitle', 'ownerPrincipal', 'ownerProfile', 'ownerNames', 'ownerListings',
   'domainTitle', 'domainStatus', 'domainOwner', 'domainProfile', 'domainListing',
   'domainActions', 'domainOwnerTools', 'poaSellTools', 'poaSellBtn', 'poaAuctionBtn',
   'poaSubnameTools', 'unitSellTools', 'listingPromptStatus', 'listPriceInput',
   'domainPreviousFields', 'domainHistory', 'domainCopyLink',
   'manageOwnerLabelRow', 'manageOwner', 'manageLookup', 'manageOwnerNotice',
   'manageNames', 'managePromptPanel', 'managePrompt', 'managePromptMeta',
   'copyManagePrompt', 'downloadManageJSON', 'clearManagePrompt', 'managePromptStatus',
   'managedDomainsBadge', 'managedDomainsSr', 'escrowPayer', 'siteTitle',
  ]) {
   const n = makeNode(id.includes('Input') || id === 'manageOwner' || id === 'escrowPayer' ? 'input' : id.includes('Btn') || id.includes('Lookup') ? 'button' : 'div');
   n.id = id;
  }

  const ownerA = 'poa1jHQCeVa5Px8zUovaVytLin8eL1yw3RPStW1sAtCpiRf';
  const ownerB = 'poa1GHppB8pYZ43gK8yBzR1RJhzfWjzrJn29q96ykwngUP7N';
  const hiddenOwner = 'poa1' + '1'.repeat(31) + '9';
  const avatarCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
  const rightsHash = 'f'.repeat(64);
  const d1 = 'a'.repeat(64), d2 = 'b'.repeat(64), d3 = 'c'.repeat(64);

  ui.demo = false;
  ui.base = 'https://poadomains.grok.me';
  ui.registryReadFailed = false;
  ui.details = { roles: {} };
  ui.reservedSet = new Set();
  ui.cart = [];
  ui.escrowMarketServerTime = 500000;
  ui.escrowMarket = [
   { id: 's1', name: 'comet', seller: ownerA, kind: 'fixed', price: '50.000000', status: 'OPEN', closes: 900000, history: [] },
  ];
  ui.cap = {
   poaOnly: { status: 'on' },
   actions: { setPrimaryName: ['name', 'expectedDeedId', 'expectedVersion'], transfer: ['name', 'expectedDeedId', 'expectedVersion', 'recipient'], setMetadata: ['name', 'expectedDeedId', 'expectedVersion', 'metadata'] },
   ownership: { disabledActions: ['renewLease', 'expireLease'] },
   publicView: { unavailableNameKeys: [], unavailableAccountKeys: [] },
  };
  ui.latestState = {
   time: 1000,
   sequence: 5,
   primaryNames: { [ownerA]: 'nebula', [ownerB]: 'peer' },
   names: {
    nebula: { name: 'nebula', activeId: d1, auctionId: null },
    comet: { name: 'comet', activeId: d2, auctionId: null },
    peer: { name: 'peer', activeId: d3, auctionId: null },
   },
   deeds: {
    [d1]: {
     id: d1, name: 'nebula', parentId: null, owner: ownerA, version: 3, ownerVersion: 1, retired: false,
     rights: { kind: 'permanent' }, rightsHash,
     records: [{ type: 'service', url: 'https://nebula.example' }, { type: 'wallet', chain: 'poa', address: ownerA }, { type: 'ipfs', cid: avatarCid }],
     metadata: [{
      cid: avatarCid,
      document: { schema: 'poa-domains.profile.v1', version: 1, name: 'nebula', rightsHash, poa: ownerA, btc: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', eth: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', description: 'Main bio', image: `ipfs://${avatarCid}` },
     }],
     previousFields: [{ owner: ownerB, ownerVersion: 1, transferredAt: 900, records: [], profile: { cid: avatarCid, document: { schema: 'poa-domains.profile.v1', version: 1, name: 'nebula', rightsHash, poa: ownerB, btc: null, eth: null, description: 'Old bio', image: null } } }],
    },
    [d2]: { id: d2, name: 'comet', parentId: null, owner: ownerA, version: 1, ownerVersion: 1, retired: false, rights: { kind: 'permanent' }, rightsHash, records: [], metadata: [], profileResetAt: 1 },
    [d3]: { id: d3, name: 'peer', parentId: null, owner: ownerB, version: 1, ownerVersion: 1, retired: false, rights: { kind: 'permanent' }, rightsHash, records: [], metadata: [] },
   },
   offers: {},
   auctions: {},
   bids: {},
   receipts: {},
  };

  // 1. applySiteTitle initial + creative remix preserves #siteHomeBtn and updates signature
  const headerHost = makeNode('header');
  headerHost.append(byId.get('siteTitle'));
  const initTitle = renderMod.applySiteTitle();
  assert.equal(initTitle.text, '🅿️🅾️🅰️D🅾️Ⓜ️🅰️INS');
  const homeBtn = byId.get('siteHomeBtn');
  assert.ok(homeBtn && homeBtn.parentNode === headerHost);
  assert.equal(byId.get('siteTitle').children.length, 10);
  const remix1 = renderMod.applySiteTitle({ creative: true });
  assert.equal(byId.get('siteHomeBtn'), homeBtn);
  assert.equal(byId.get('siteTitle').children.length, 10);
  assert.notEqual(byId.get('siteTitle').dataset.titleSig, `${initTitle.text}|flat|blue`);
  const remix2 = renderMod.applySiteTitle({ creative: true });
  assert.notEqual(remix2.signature, remix1.signature);

  // 2. ownerLink renders main domain + avatar for ownerA, and falls back to address when no primary is set
  const linkBox = makeNode('p');
  routerMod.ownerLink(linkBox, ownerA);
  assert.ok(collectText(linkBox).includes('nebula'));
  const plainBox = makeNode('p');
  routerMod.ownerLink(plainBox, hiddenOwner);
  assert.ok(collectText(plainBox).includes('poa1...1119'));

  // 2. renderOwnerPage via domain name & via address displays main domain + profile fields + held names + POA listings
  domainMod.renderOwnerPage('comet');
  assert.ok(collectText(byId.get('ownerTitle')).includes('nebula'));
  assert.ok(collectText(byId.get('ownerProfile')).includes('Main bio'));
  assert.equal(byId.get('ownerProfile').hidden, false);
  assert.ok(collectText(byId.get('ownerNames')).includes('nebula'));
  assert.ok(collectText(byId.get('ownerListings')).includes('comet'));

  // renderOwnerPage without a primary name hides #ownerProfile
  domainMod.renderOwnerPage(hiddenOwner);
  assert.equal(byId.get('ownerTitle').textContent, '👤 Owner profile');
  assert.equal(byId.get('ownerProfile').hidden, true);

  // 3. renderDomainPage for unlisted primary domain and listed domain
  domainMod.renderDomainPage('nebula');
  assert.ok(collectText(byId.get('domainProfile')).includes('Main bio'));
  assert.ok(collectText(byId.get('domainPreviousFields')).includes('Old bio'));
  domainMod.renderDomainPage('comet');
  assert.ok(collectText(byId.get('domainProfile')).includes('paused while listed'));

  // 4. Manage domains: wireManagement, lookup by domain name, main domain buttons, and Transfer review/confirm/cancel
  ui.escrowMarket = [];
  manageMod.wireManagement();
  byId.get('manageOwner').value = 'comet';
  await byId.get('manageLookup').click();
  assert.equal(byId.get('manageOwnerNotice').hidden, false);
  assert.ok(collectText(byId.get('manageOwnerNotice')).includes('comet'));

  const clearBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.clearPrimaryDomain === 'nebula')[0];
  assert.ok(clearBtn);
  await clearBtn.click();
  assert.ok(copied.at(-1).includes('"name": null'));

  const setBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.setPrimaryDomain === 'comet')[0];
  assert.ok(setBtn);
  await setBtn.click();
  assert.ok(copied.at(-1).includes('setPrimaryName'));
  assert.ok(copied.at(-1).includes('"name": "comet"'));

  const toggleBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.transferToggle === 'comet')[0];
  const toInput = findAll(byId.get('manageNames'), (n) => n.dataset?.transferRecipient === 'comet')[0];
  const reviewBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.transferReview === 'comet')[0];
  const confirmBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.transferConfirm === 'comet')[0];
  const backBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.transferBack === 'comet')[0];
  const cancelBtn = findAll(byId.get('manageNames'), (n) => n.dataset?.transferClose === 'comet')[0];
  const errEl = findAll(byId.get('manageNames'), (n) => n.dataset?.transferError === 'comet')[0];
  const confirmBox = findAll(byId.get('manageNames'), (n) => n.dataset?.transferConfirmBox === 'comet')[0];

  await toggleBtn.click();
  toInput.value = 'unknown-domain';
  toInput.dispatchEvent({ type: 'input' });
  await reviewBtn.click();
  assert.ok(errEl.textContent.includes('valid poa1'));
  assert.equal(confirmBox.hidden, true);

  toInput.value = 'peer';
  toInput.dispatchEvent({ type: 'input' });
  await reviewBtn.click();
  assert.equal(confirmBox.hidden, false);
  await backBtn.click();
  assert.equal(confirmBox.hidden, true);
  await reviewBtn.click();
  await confirmBtn.click();
  assert.ok(copied.at(-1).includes('"recipient": "' + ownerB + '"'));
  assert.ok(copied.at(-1).includes('resets all attached profile fields'));
  await cancelBtn.click();

  // Invalid owner lookup clears notice and displays warning
  byId.get('manageOwner').value = 'not-a-valid-domain-or-key';
  await byId.get('manageLookup').click();
  assert.ok(collectText(byId.get('manageNames')).includes('never a private key'));
  byId.get('manageOwner').value = '';
  await byId.get('manageLookup').click();
  assert.equal(byId.get('managePromptPanel').hidden, true);
 } finally {
  Object.assign(ui, prevUi);
  globalThis.document = prevDoc;
  globalThis.localStorage = prevStorage;
  if (prevLoc) Object.defineProperty(globalThis, 'location', prevLoc); else delete globalThis.location;
  if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav); else delete globalThis.navigator;
 }
});
