import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createIdeaGenerator,ideaPools} from "../reference-web/ideas-generator.js";
import {MAX_RECENT_ACTIONS,recentActions} from "../reference-web/ui-ticker.js";
import {ui} from "../reference-web/ui-state.js";
import {actionLabel,buttonIcon,decorateEmojiButton} from "../reference-web/ui-copy.js";
import {managedNames,managementPlan} from "../reference-web/ui-manage.js";
import {CRYPTO_IDEA_WORDS,IDEA_WORDS,inspectName} from "../reference-web/shared.js";
import {profileEngine} from "./fixtures/ui-harness.mjs";
import {capabilities} from "../dist/src/interface.js";
const cap=capabilities(profileEngine('mainnet'));
test('funny single crypto words are valid root names and appear in default & crypto suggestion pools',()=>{
 assert.ok(CRYPTO_IDEA_WORDS.length>=30);
 for(const w of CRYPTO_IDEA_WORDS){assert.match(w,/^[a-z]+$/);const n=inspectName(w,cap.emojiManifest);assert.ok(n.isRoot&&n.emojiCount===0,w);}
 const defWords=ideaPools('',cap.emojiManifest).words;
 assert.ok(defWords.slice(0,12).filter(w=>CRYPTO_IDEA_WORDS.includes(w)).length>=4,'Funny crypto words should appear immediately in the suggested window');
 for(const w of ['hodl','rekt','wagmi','degen','copium','lambo'])assert.ok(IDEA_WORDS.includes(w),w);
 const cryptoPool=ideaPools('crypto',cap.emojiManifest);
 assert.ok(cryptoPool.related&&cryptoPool.words.includes('hodl')&&cryptoPool.words.includes('copium'));
});
test('separate single words / double emoji / single emoji keep generating with bounded recent exclusions',()=>{
 const g=createIdeaGenerator({query:'moon',manifest:cap.emojiManifest});for(const lane of ['words','double','single']){const out=[];for(let i=0;i<250;i++){const q=g.next(lane);assert.ok(q,lane+' exhausted');const n=inspectName(q,cap.emojiManifest);assert.ok(n.isRoot);assert.equal(n.emojiCount,lane==='words'?0:lane==='double'?2:1);if(lane==='words')assert.match(q,/^[a-z]+$/);out.push(q);}assert.ok(new Set(out).size>20);}
 assert.ok(ideaPools('robot',cap.emojiManifest).words.includes('robothub'));assert.ok(ideaPools('robot',cap.emojiManifest).related);const pools=ideaPools('moon',cap.emojiManifest);assert.ok(pools.related);assert.equal(pools.words[0],'moonbeam');assert.equal(createIdeaGenerator({manifest:cap.emojiManifest,accept:()=>false}).next('single'),null);
});
test('UI uses human actions, actual info, footer-only project links and no Ideas control buttons',()=>{assert.equal(actionLabel('announceAuction+bid'),'Start auction + place bid');for(const name of ['createChildOffer','buyFixed','setRecords'])assert.doesNotMatch(actionLabel(name),/[a-z][A-Z]/);const html=readFileSync('reference-web/index.html','utf8');assert.ok(html.indexOf('id="ideasStrip"')<html.indexOf('id="searchInput"'));assert.doesNotMatch(html,/id="ideas(?:Pause|Shuffle)"/);assert.doesNotMatch(html,/id="floatingInfo"/);assert.match(html,/id="searchHelp"/);assert.match(html,/Query text is saved/);assert.match(html,/>Manage domains</);assert.match(html,/advancedHandoff/);assert.match(html,/made with ❤️ in SF by<br \/><span id="footerCreditOwner">poa12XVYtPngbDsm1igG9GPeWPXAHDFTZ1bBLuSwhjqBrQ5U<\/span>/);assert.match(html,/id="freshness"[^>]*data-info-description/);assert.match(html,/id="cartExpectations"[^>]*data-info-description/);assert.match(html,/id="floatingCartExpectations"[^>]*data-info-description/);const preFooter=html.split('<footer')[0];assert.ok(!preFooter.includes('https://github.com/maximusmaximus/poa-domains'));assert.ok(!preFooter.includes('https://maximusmaximus.github.io/poa-domains/'));});
test('management includes owned children and honest retirement co-signing, without state mutation',()=>{const root={id:'root',name:'garden',owner:'owner',version:3,ownerVersion:2},child={id:'child',name:'seed.garden',owner:'owner',version:4,parentId:'root'},state={time:100,names:{garden:{activeId:'root'},'seed.garden':{activeId:'child'}},deeds:{root,child}};const before=JSON.stringify(state);assert.equal(managedNames(state,'owner').length,2);const offer=managementPlan('createChildOffer',root,state,'owner','250');assert.equal(offer.params.rights.kind,'permanent');assert.equal(offer.params.maxUses,1);assert.equal(managementPlan('revokeChild',child,state,'owner').coSigners[0],'owner');assert.throws(()=>managementPlan('createChildOffer',child,state,'owner'));assert.throws(()=>managementPlan('sellFixed',child,state,'other'));assert.throws(()=>managementPlan('sellFixed',child,state,'owner','-1'));assert.equal(JSON.stringify(state),before);});

test('the ticker includes every committed receipt, including rejected actions and names missing from legacy projection',()=>{const state={time:1,names:{},deeds:{},receipts:{a:{intentId:'a',sequence:1,status:'rejected',result:{name:'garden'}},b:{intentId:'b',sequence:2,status:'succeeded',result:{}},c:{intentId:'c',sequence:3,status:'succeeded',result:{name:'ocean'}}}};const items=recentActions(state);assert.equal(items.length,3);assert.deepEqual(items.map(x=>x.sequence),[3,2,1]);assert.ok(items.find(x=>x.name==='garden').label.includes('garden'));});

test('the ticker merges registry seconds and escrow milliseconds newest-first, labels profile/main-domain receipts, ignores future offer expiry, and caps strictly at 100 actions',()=>{
 assert.equal(MAX_RECENT_ACTIONS,100);
 assert.ok(ui.TICKER_MS<=5000,'near-real-time poll interval must be <=5s');
 const baseSec=1_795_746_000;
 const receipts={},deeds={};
 for(let i=1;i<=125;i++){
  const id=`deed-${i}`,name=`n${i}`;
  deeds[id]={id,name,owner:'poa1Owner',retired:false};
  receipts[`r-${i}`]={intentId:`r-${i}`,sequence:i,time:baseSec+i*10,status:'succeeded',result:{deedId:id,owner:'poa1Owner'}};
 }
 receipts['r-126']={intentId:'r-126',sequence:126,time:baseSec+1260,status:'succeeded',result:{signer:'poa1Owner',primaryName:'army',deedId:'deed-125'}};
 receipts['r-127']={intentId:'r-127',sequence:127,time:baseSec+1270,status:'succeeded',result:{metadataVersion:2}};
 const offers={old:{id:'offer-old',kind:'resale',parentId:'deed-1',price:'100',asset:'POA',sequence:1,validUntil:baseSec+9999999,cancelled:false,uses:0,maxUses:1}};
 const market=[
  {id:'a'.repeat(64),kind:'auction',name:'oldwon',status:'COMPLETE',awaitingFirstBid:false,price:'100.000000',high:{payer:'poa1B',amount:'100.000000'},closes:(baseSec-5000)*1000,history:[{event:'Payment and title complete',at:(baseSec-5000)*1000,amount:'100.000000'}]},
  {id:'b'.repeat(64),kind:'auction',name:'freshbid',status:'OPEN',awaitingFirstBid:false,price:'100.000000',high:{payer:'poa1B',amount:'150.000000'},startedAt:(baseSec+1265)*1000,closes:(baseSec+4865)*1000,history:[{event:'Auction started (first bid)',at:(baseSec+1265)*1000,amount:'100.000000'},{event:'Bid placed',at:(baseSec+1275)*1000,amount:'150.000000'}]},
  {id:'c'.repeat(64),kind:'fixed',name:'listednow',status:'OPEN',price:'250.000000',high:null,createdAt:(baseSec+1268)*1000,history:[{event:'listed',at:(baseSec+1268)*1000,amount:'250.000000'}]},
 ];
 const items=recentActions({time:baseSec+1280,names:{},deeds,receipts,offers},market);
 assert.equal(items.length,100);
 // Exact newest-first ordering across ms escrow events and sec registry receipts
 assert.equal(items[0].id,`escrow-bid:${'b'.repeat(64)}:150.000000`);
 assert.equal(items[1].id,'receipt:r-127');
 assert.match(items[1].label,/Profile updated · #127/);
 assert.equal(items[2].id,`escrow-listed:${'c'.repeat(64)}`);
 assert.match(items[2].label,/Listed · listednow · 250 POA/);
 assert.equal(items[3].id,`escrow-started:${'b'.repeat(64)}`);
 assert.equal(items[4].id,'receipt:r-126');
 assert.match(items[4].label,/Main domain · army/);
 assert.equal(items[5].id,'receipt:r-125');
 // Stale 18h-old auction and ancient future-expiring offer must NOT jump to front (and drop past 100)
 assert.ok(!items.some(x=>x.name==='oldwon'),'stale auction beyond last 100 must be dropped');
 assert.ok(!items.some(x=>x.id==='offer:offer-old'),'old offer with future validUntil must not pin to top');
});

test('v3 keeps headerless masonry, flat closable status and always-visible corner help',()=>{
 const html=readFileSync('reference-web/index.html','utf8'),css=readFileSync('reference-web/style.css','utf8'),help=readFileSync('reference-web/ui-help.js','utf8'),ideas=readFileSync('reference-web/ui-ideas.js','utf8');
 assert.doesNotMatch(html,/<h3 id="ideasHeading"/);assert.match(ideas,/idea-offset-/);assert.doesNotMatch(ideas,/add\(group,"h4"/);
 assert.doesNotMatch(html,/id="(?:statusReopen|floatingInfo|infoHint)"|registry-read-status|<h2>🔍 Find a name/);
 assert.match(css,/\.module-info \{ display:inline-flex/);assert.match(css,/grid-template-columns:repeat\(10,minmax\(0,1fr\)\)/);
 assert.match(html,/<h2 id="searchHeading" class="visually-hidden">/);assert.match(html,/<label id="searchLabel" for="searchInput">Check Availability<\/label>/);assert.ok(html.indexOf('id="searchHelpText"')>html.indexOf('id="searchBtn"'));
 assert.equal((html.match(/id="networkStatusBar"/g)??[]).length,1);assert.match(help,/escrowAmount/);assert.match(help,/input.before\(wrap\)/);assert.match(help,/dismiss.after\(b\)/);assert.match(help,/module.append\(p\)/);assert.doesNotMatch(help,/fetch\(|request\(|sign\(/);
});
test('emoji actions retain exact accessible purpose and leave technical payment/signing controls alone',()=>{
 for(const [label,icon]of [['Check','🔍'],['Add to cart','🛒'],['Copy prompt','📋'],['Clear','🗑️'],['Close','❌'],['History','📜'],['✅ Review changed item','🔎']]){
  assert.equal(buttonIcon(label),icon);const attrs=new Map(),classes=[];
  const b={textContent:label,closest:()=>false,hasAttribute:k=>attrs.has(k),setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k),classList:{add:c=>classes.push(c)}};
  decorateEmojiButton(b);assert.equal(b.textContent,icon);assert.equal(attrs.get('aria-label'),label);assert.equal(b.title,label);assert.ok(classes.includes('emoji-control'));
 }
 for(const technical of ['Generate','Copy unsigned request','Use credited POA to buy','Prepare: Offer subdomains'])assert.equal(buttonIcon(technical),null);
 const untouched={textContent:'Copy prompt',closest:()=>true};decorateEmojiButton(untouched);assert.equal(untouched.textContent,'Copy prompt');
});

test('v4 keeps privacy and non-guaranteed/unsigned explanations in per-area help, with a gentle motion-safe field',()=>{
 const html=readFileSync('reference-web/index.html','utf8'),css=readFileSync('reference-web/style.css','utf8'),help=readFileSync('reference-web/ui-help.js','utf8');
 for(const id of ['searchHelpText','searchPrivacy','searchLogStatus','searchLastChecked'])assert.ok(html.includes('data-info-description id="'+id+'"'));
 assert.match(help,/Availability is not guaranteed/);assert.match(help,/query text itself is stored/);assert.match(help,/unsigned plan, not a payment/);assert.match(help,/filter\(n=>!n.closest\(".info-popover"\)\)/);
 assert.match(css,/@keyframes search-invite/);assert.match(css,/animation:search-invite 4s ease-in-out infinite/);assert.match(css,/#searchInput:focus,#searchInput\[data-typing="true"\]/);assert.match(css,/@media\(prefers-reduced-motion:reduce\) \{ #searchInput \{ animation:none/);
 assert.match(help,/field.addEventListener\("input"/);assert.match(css,/min-height:64px/);
});

test('separate-window Terms reuse the same eight documented live policy sections on Worker and Mirror Site',()=>{
 const html=readFileSync('reference-web/index.html','utf8'),footer=html.split('<footer')[1],terms=readFileSync('reference-web/terms.html','utf8');
 assert.doesNotMatch(html,/id="siteTerms"/);assert.match(footer,/href="\/terms" target="_blank" rel="noopener noreferrer"/);
 for(const section of ['📜 About','🔑 Ownership','💰 Payments &amp; fees','↩️ Refunds','🤖 Agents','🔒 Privacy &amp; search logs','⚠️ Risks','⚖️ Disputes'])assert.ok(terms.includes('<h2>'+section+'</h2>'));
 for(const truth of ['no renewals or expiry','original payer','no automatic refund','Query text is saved','not atomic','not guaranteed','no built-in arbitration'])assert.ok(terms.includes(truth),truth);
 assert.doesNotMatch(terms,/<script|<form|coming\s+soon|future\s+plans/i);assert.match(terms,/href="\.\/"/);
 assert.equal((footer.match(/class="github-mark"/g)??[]).length,2);assert.equal((footer.match(/aria-hidden="true" focusable="false"/g)??[]).length,2);assert.match(footer,/>Mirror Site<\/span>/);assert.doesNotMatch(footer,/GitHub Pages/);
});
